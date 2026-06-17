import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

interface SigningField {
  id: string
  type: 'signature' | 'initials' | 'date' | 'text' | 'checkbox'
  page: number
  x: number; y: number; w: number; h: number
  signer_id: string
  required: boolean
  label?: string
}

// Merge all signer field data into the PDF at exact field coordinates
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [{ data: session }, { data: signerRows }] = await Promise.all([
    serviceClient.from('signing_sessions').select('*').eq('id', id).eq('user_id', user.id).single(),
    serviceClient.from('session_signers').select('*').eq('session_id', id),
  ])

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const allSigned = (signerRows ?? []).every(r => r.status === 'signed')
  if (!allSigned) return NextResponse.json({ error: 'Not all signers have signed' }, { status: 400 })

  // Download base PDF
  const { data: pdfFile } = await serviceClient.storage.from('documents').download(session.pdf_path)
  if (!pdfFile) return NextResponse.json({ error: 'Could not load PDF' }, { status: 500 })

  const pdfBytes = await pdfFile.arrayBuffer()
  const pdfDoc  = await PDFDocument.load(pdfBytes)
  const pages   = pdfDoc.getPages()
  const font    = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const fields = (session.fields as SigningField[]) ?? []
  const sessionSigners = (session.signers as { id: string; name: string; color: string }[]) ?? []

  // Build a map: signer_ref_id → their fields_data
  const fieldsDataMap: Record<string, Record<string, string>> = {}
  for (const row of (signerRows ?? [])) {
    fieldsDataMap[row.signer_ref_id] = (row.fields_data as Record<string, string>) ?? {}
  }

  for (const field of fields) {
    const page = pages[field.page - 1]
    if (!page) continue
    const { width: pw, height: ph } = page.getSize()

    const fx = field.x * pw
    const fy = ph - (field.y * ph) - (field.h * ph)  // pdf-lib y is from bottom
    const fw = field.w * pw
    const fh = field.h * ph

    const signerRow = (signerRows ?? []).find(r => r.signer_ref_id === field.signer_id)
    const value = signerRow ? fieldsDataMap[signerRow.signer_ref_id]?.[field.id] : undefined

    if (!value) continue

    if (field.type === 'signature' || field.type === 'initials') {
      if (value.startsWith('data:image/png;base64,')) {
        try {
          const base64 = value.replace('data:image/png;base64,', '')
          const imgBytes = Uint8Array.from(Buffer.from(base64, 'base64'))
          const img = await pdfDoc.embedPng(imgBytes)
          page.drawImage(img, { x: fx, y: fy, width: fw, height: fh, opacity: 0.95 })
        } catch { /* skip bad image */ }
      } else {
        // Typed signature — draw as italic text
        const fontSize = Math.min(fh * 0.6, 18)
        page.drawText(value, {
          x: fx + 4, y: fy + fh / 2 - fontSize / 2,
          size: fontSize, font: fontItalic, color: rgb(0.04, 0.08, 0.26),
        })
      }
    } else if (field.type === 'date') {
      const fontSize = Math.min(fh * 0.55, 12)
      page.drawText(value, {
        x: fx + 4, y: fy + fh / 2 - fontSize / 2,
        size: fontSize, font, color: rgb(0.1, 0.1, 0.1),
      })
    } else if (field.type === 'text') {
      const fontSize = Math.min(fh * 0.55, 11)
      page.drawText(value, {
        x: fx + 4, y: fy + fh / 2 - fontSize / 2,
        size: fontSize, font, color: rgb(0.1, 0.1, 0.1),
      })
    } else if (field.type === 'checkbox' && value === 'checked') {
      const sz = Math.min(fw, fh) * 0.7
      const cx = fx + fw / 2 - sz / 2
      const cy = fy + fh / 2 - sz / 2
      page.drawText('✓', { x: cx, y: cy, size: sz * 0.9, font, color: rgb(0.04, 0.08, 0.26) })
    }

  }

  const completedPdfBytes = await pdfDoc.save()
  const completedPath = `signed/${user.id}/${id}_completed_${Date.now()}.pdf`

  const { error: uploadErr } = await serviceClient.storage
    .from('documents')
    .upload(completedPath, completedPdfBytes, { contentType: 'application/pdf', upsert: true })

  if (uploadErr) return NextResponse.json({ error: 'Failed to save completed PDF' }, { status: 500 })

  // Generate certificate
  const certPath = await generateCertificate({
    userId: user.id, sessionId: id, session, signerRows: signerRows ?? [],
  })

  // Update session
  await serviceClient.from('signing_sessions').update({
    status: 'completed',
    completed_pdf_path: completedPath,
    certificate_path: certPath,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  // Auto-link the completed PDF as a permanent documents record so it appears
  // in Document Center, and any linked Contact / Deal / Lead / Property tabs.
  try {
    await serviceClient.from('documents').insert({
      name:            `${String(session.title ?? 'Signed Document')} — Fully Signed`,
      category:        'contract',
      status:          'fully_signed',
      signed_pdf_path: completedPath,
      property_id:     (session.property_id as string | null) ?? null,
      lead_id:         (session.lead_id     as string | null) ?? null,
      contact_id:      (session.contact_id  as string | null) ?? null,
      deal_id:         (session.deal_id     as string | null) ?? null,
      created_by:      user.id,
      created_at:      new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    })
  } catch { /* best-effort */ }

  // Email completed docs (best-effort)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nextkeyos.vercel.app'
  try {
    const { sendEmail, getTokenRecord } = await import('@/lib/gmail')
    const gmailToken = await getTokenRecord(user.id)
    if (gmailToken && certPath) {
      const [{ data: pdfSignedUrl }, { data: certUrl }] = await Promise.all([
        serviceClient.storage.from('documents').createSignedUrl(completedPath, 86400 * 30),
        serviceClient.storage.from('documents').createSignedUrl(certPath, 86400 * 30),
      ])

      const [completedFile, certFile] = await Promise.all([
        serviceClient.storage.from('documents').download(completedPath),
        serviceClient.storage.from('documents').download(certPath),
      ])

      const attachments = []
      if (completedFile.data) {
        const b = Buffer.from(await completedFile.data.arrayBuffer()).toString('base64')
        attachments.push({ filename: `${session.title} - Signed.pdf`, mimeType: 'application/pdf', data: b })
      }
      if (certFile.data) {
        const b = Buffer.from(await certFile.data.arrayBuffer()).toString('base64')
        attachments.push({ filename: `${session.title} - Certificate.pdf`, mimeType: 'application/pdf', data: b })
      }

      const body = `<p>All parties have signed <strong>${session.title}</strong>.</p>
<p>The fully executed contract and certificate of completion are attached.</p>
<p style="color:#888;font-size:12px;">Powered by NextKey OS</p>`

      const recipients = [
        gmailToken.email,
        ...(signerRows ?? []).map(r => r.email),
      ]
      for (const to of recipients) {
        await sendEmail(user.id, { to, subject: `✅ Fully Executed: ${session.title}`, body, attachments }).catch(() => {})
      }
    }
  } catch { /* best effort */ }

  const { data: completedUrl } = await serviceClient.storage.from('documents').createSignedUrl(completedPath, 3600)
  const { data: certSignedUrl } = certPath
    ? await serviceClient.storage.from('documents').createSignedUrl(certPath, 3600)
    : { data: null }

  return NextResponse.json({
    ok: true,
    completed_pdf_url: completedUrl?.signedUrl,
    certificate_url: certSignedUrl?.signedUrl,
  })
}

async function generateCertificate({
  userId, sessionId, session, signerRows,
}: {
  userId: string
  sessionId: string
  session: Record<string, unknown>
  signerRows: { name: string; email: string; role?: string; status: string; signed_at?: string; signer_ip?: string }[]
}) {
  const cert = await PDFDocument.create()
  const page = cert.addPage([612, 792]) // Letter
  const { height } = page.getSize()
  const font = await cert.embedFont(StandardFonts.Helvetica)
  const fontBold = await cert.embedFont(StandardFonts.HelveticaBold)
  const navy  = rgb(0.04, 0.12, 0.27)
  const gold  = rgb(0.79, 0.66, 0.30)
  const grey  = rgb(0.45, 0.45, 0.45)
  const black = rgb(0.1, 0.1, 0.1)

  let y = height - 60

  // Header bar
  page.drawRectangle({ x: 0, y: height - 80, width: 612, height: 80, color: navy })
  page.drawText('CERTIFICATE OF COMPLETION', {
    x: 40, y: height - 42, size: 16, font: fontBold, color: gold,
  })
  page.drawText('NextKey OS · Electronic Signature', {
    x: 40, y: height - 62, size: 9, font, color: rgb(0.7, 0.7, 0.7),
  })

  y = height - 110

  const drawLabel = (label: string, value: string, yPos: number) => {
    page.drawText(label, { x: 40, y: yPos, size: 8, font, color: grey })
    page.drawText(value, { x: 180, y: yPos, size: 9, font: fontBold, color: black })
    return yPos - 18
  }

  y = drawLabel('Document:', (session.title as string) ?? 'Untitled', y)
  y = drawLabel('Session ID:', sessionId, y)
  y = drawLabel('Completed:', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }), y)

  y -= 20
  page.drawLine({ start: { x: 40, y }, end: { x: 572, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) })
  y -= 20

  page.drawText('SIGNING DETAILS', { x: 40, y, size: 9, font: fontBold, color: navy })
  y -= 20

  for (const signer of signerRows) {
    page.drawRectangle({ x: 36, y: y - 58, width: 540, height: 64, color: rgb(0.97, 0.97, 0.97), borderColor: rgb(0.87, 0.87, 0.87), borderWidth: 0.5, opacity: 1 })
    page.drawText(`${signer.name}${signer.role ? ` — ${signer.role}` : ''}`, { x: 50, y: y - 12, size: 10, font: fontBold, color: black })
    page.drawText(signer.email, { x: 50, y: y - 26, size: 8, font, color: grey })
    const signedAt = signer.signed_at
      ? new Date(signer.signed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Not signed'
    page.drawText(`Signed: ${signedAt}`, { x: 50, y: y - 40, size: 8, font, color: black })
    if (signer.signer_ip) {
      page.drawText(`IP: ${signer.signer_ip}`, { x: 50, y: y - 54, size: 7, font, color: grey })
    }
    // Status badge
    const badgeColor = signer.status === 'signed' ? rgb(0.18, 0.62, 0.45) : rgb(0.7, 0.3, 0.3)
    page.drawRectangle({ x: 490, y: y - 22, width: 72, height: 18, color: badgeColor })
    page.drawText(signer.status.toUpperCase(), { x: 494, y: y - 16, size: 8, font: fontBold, color: rgb(1, 1, 1) })
    y -= 78
  }

  y -= 10
  page.drawLine({ start: { x: 40, y }, end: { x: 572, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) })
  y -= 20

  const disclaimer = 'This certificate confirms that the attached document was electronically signed by the parties listed above through NextKey OS, an electronic signature platform. Electronic signatures executed on this platform are legally binding under the Electronic Signatures in Global and National Commerce Act (ESIGN) and the Uniform Electronic Transactions Act (UETA).'
  const words = disclaimer.split(' ')
  let line = ''; const lines: string[] = []
  for (const w of words) {
    if (font.widthOfTextAtSize(line + w + ' ', 7.5) > 530) { lines.push(line.trim()); line = w + ' ' }
    else line += w + ' '
  }
  if (line.trim()) lines.push(line.trim())
  for (const l of lines) {
    page.drawText(l, { x: 40, y, size: 7.5, font, color: grey })
    y -= 12
  }

  const certBytes = await cert.save()
  const certPath = `certificates/${userId}/${sessionId}_certificate_${Date.now()}.pdf`
  const { error } = await serviceClient.storage.from('documents').upload(certPath, certBytes, { contentType: 'application/pdf', upsert: true })
  return error ? null : certPath
}
