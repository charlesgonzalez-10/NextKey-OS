import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

export interface Annotation {
  id: string
  type: 'text' | 'date' | 'signature' | 'initials' | 'checkmark'
  page: number          // 0-indexed
  x: number            // fraction of page width (0-1)
  y: number            // fraction of page height (0-1), 0=top
  value: string        // text value or base64 image data URL
  fontSize?: number
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { annotations } = await req.json() as { annotations: Annotation[] }

  // Load document record
  const { data: doc } = await serviceClient
    .from('documents')
    .select('*')
    .eq('id', id)
    .single()

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Determine source PDF path
  const sourcePath = (doc.signed_pdf_path || doc.pdf_path || doc.file_path) as string | null
  if (!sourcePath) return NextResponse.json({ error: 'No source file' }, { status: 400 })

  // Download the source PDF
  const { data: fileData, error: downloadErr } = await serviceClient.storage
    .from('documents')
    .download(sourcePath)

  if (downloadErr || !fileData) {
    return NextResponse.json({ error: 'Could not download source PDF' }, { status: 500 })
  }

  const pdfBytes = await fileData.arrayBuffer()
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const pages = pdfDoc.getPages()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  for (const ann of annotations) {
    const page = pages[ann.page]
    if (!page) continue
    const { width: pw, height: ph } = page.getSize()

    // Convert fractional coords (top-left origin) to pdf-lib coords (bottom-left origin)
    const pdfX = ann.x * pw
    const pdfY = ph - (ann.y * ph)

    if (ann.type === 'text' || ann.type === 'date') {
      const size = ann.fontSize ?? 11
      page.drawText(ann.value || '', {
        x: pdfX,
        y: pdfY - size,
        size,
        font,
        color: rgb(0, 0, 0),
      })
    } else if (ann.type === 'checkmark') {
      page.drawText('✓', { x: pdfX, y: pdfY - 14, size: 14, font, color: rgb(0, 0, 0) })
    } else if ((ann.type === 'signature' || ann.type === 'initials') && ann.value?.startsWith('data:image/')) {
      // Embed signature image
      try {
        const base64 = ann.value.replace(/^data:image\/\w+;base64,/, '')
        const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        const img = ann.value.includes('image/png')
          ? await pdfDoc.embedPng(imgBytes)
          : await pdfDoc.embedJpg(imgBytes)
        const sigW = ann.type === 'initials' ? 60 : 160
        const sigH = ann.type === 'initials' ? 30 : 55
        page.drawImage(img, { x: pdfX, y: pdfY - sigH, width: sigW, height: sigH })
      } catch {}
    }
  }

  const annotatedBytes = await pdfDoc.save()

  // Save annotated PDF to storage (new path under same user prefix)
  const timestamp = Date.now()
  const baseName = sourcePath.split('/').pop()?.replace(/\.pdf$/i, '') ?? 'document'
  const newPath = `${user.id}/${timestamp}_${baseName}_annotated.pdf`

  const { error: uploadErr } = await serviceClient.storage
    .from('documents')
    .upload(newPath, annotatedBytes, { contentType: 'application/pdf', upsert: false })

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 })
  }

  // Update document record — store as signed_pdf_path and set status
  const { data: updated, error: dbErr } = await serviceClient
    .from('documents')
    .update({ signed_pdf_path: newPath, status: 'signed_by_me', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  // Snapshot as a new version
  const { data: latest } = await serviceClient
    .from('document_versions')
    .select('version')
    .eq('document_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (latest?.version ?? 0) + 1
  await serviceClient.from('document_versions').insert({
    document_id: id, version: nextVersion, file_path: newPath, created_by: user.id,
  })
  await serviceClient.from('document_activity').insert({
    document_id: id, action: 'signed', notes: `Annotated — version ${nextVersion} saved`, created_by: user.id,
  })

  return NextResponse.json({ document: updated, path: newPath })
}
