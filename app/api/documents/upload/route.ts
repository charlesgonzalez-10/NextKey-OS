import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

const MIME_TO_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'docx',
  'text/plain': 'txt',
}

const MIME_TO_CATEGORY: Record<string, string> = {
  'image/jpeg': 'photo',
  'image/jpg': 'photo',
  'image/png': 'photo',
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const files = formData.getAll('files') as File[]
  const property_id = formData.get('property_id') as string | null
  const lead_id     = formData.get('lead_id')     as string | null
  const contact_id  = formData.get('contact_id')  as string | null
  const deal_id     = formData.get('deal_id')     as string | null
  const category    = formData.get('category')    as string | null

  if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 })

  const results = []
  const errors  = []

  for (const file of files) {
    const mimeType = file.type || 'application/octet-stream'
    const fileType = MIME_TO_TYPE[mimeType] ?? 'pdf'
    const detectedCategory = category || MIME_TO_CATEGORY[mimeType] || 'other'
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()
    const path = `${user.id}/${timestamp}_${safeName}`

    const buffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(buffer)

    const { error: uploadErr } = await serviceClient.storage
      .from('documents')
      .upload(path, uint8, { contentType: mimeType, upsert: false })

    if (uploadErr) {
      errors.push({ file: file.name, error: uploadErr.message })
      continue
    }

    const { data: doc, error: dbErr } = await serviceClient
      .from('documents')
      .insert({
        name:          file.name,
        category:      detectedCategory,
        status:        'draft',
        document_type: 'uploaded',
        file_path:     path,
        file_type:     fileType,
        property_id:   property_id || null,
        lead_id:       lead_id     || null,
        contact_id:    contact_id  || null,
        deal_id:       deal_id     || null,
        created_by:    user.id,
      })
      .select()
      .single()

    if (dbErr) {
      errors.push({ file: file.name, error: dbErr.message })
    } else {
      results.push(doc)
    }
  }

  return NextResponse.json({ documents: results, errors }, { status: 201 })
}
