import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { PDFDocument } from 'pdf-lib'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file     = formData.get('file') as File | null
  const name     = formData.get('name') as string | null
  const category = (formData.get('category') as string | null) ?? 'other'
  const description = formData.get('description') as string | null

  if (!file || !name) return NextResponse.json({ error: 'file and name are required' }, { status: 400 })
  if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Only PDF files are accepted' }, { status: 400 })

  const bytes = await file.arrayBuffer()
  let pageCount = 0
  try {
    const pdfDoc = await PDFDocument.load(bytes)
    pageCount = pdfDoc.getPageCount()
  } catch { /* ignore */ }

  const filePath = `contract-templates/${user.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const { error: uploadErr } = await serviceClient.storage
    .from('documents')
    .upload(filePath, bytes, { contentType: 'application/pdf', upsert: false })

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const { data, error } = await serviceClient
    .from('contract_templates')
    .insert({ user_id: user.id, name, description, category, file_path: filePath, page_count: pageCount })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
