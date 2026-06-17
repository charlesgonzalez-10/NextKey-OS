import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { fillTemplate } from '@/lib/documents/template-utils'
import { generateDocumentPDF } from '@/lib/documents/pdf-generator'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leadId     = searchParams.get('lead_id')
  const dealId     = searchParams.get('deal_id')
  const propertyId = searchParams.get('property_id')
  const contactId  = searchParams.get('contact_id')
  const status     = searchParams.get('status')
  const search     = searchParams.get('q')
  const category   = searchParams.get('category')

  let q = serviceClient
    .from('documents')
    .select(`
      id, name, category, status, document_type, offer_amount, recipient_name,
      sent_at, expires_at, pdf_path, signed_pdf_path, file_path, file_type,
      signing_session_id, version, is_executed, executed_at,
      created_at, updated_at, template_id, filled_data,
      property_id, lead_id, contact_id, deal_id
    `)
    .eq('created_by', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (leadId)     q = q.eq('lead_id', leadId)
  if (dealId)     q = q.eq('deal_id', dealId)
  if (propertyId) q = q.eq('property_id', propertyId)
  if (contactId)  q = q.eq('contact_id', contactId)
  if (status)     q = q.eq('status', status)
  if (category)   q = q.eq('category', category)
  if (search)     q = q.ilike('name', `%${search}%`)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    template_id, name, filled_data = {},
    property_id, lead_id, contact_id, deal_id,
    offer_amount, recipient_name, recipient_email, expires_at,
    include_signature = false,
  } = body

  // Fetch template
  const { data: tmpl, error: tmplErr } = await serviceClient
    .from('document_templates')
    .select('*')
    .eq('id', template_id)
    .single()

  if (tmplErr || !tmpl) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Fetch signature if requested
  let signatureDataUrl: string | null = null
  if (include_signature) {
    const { data: prof } = await serviceClient
      .from('user_profiles')
      .select('signature_data')
      .eq('id', user.id)
      .single()
    signatureDataUrl = prof?.signature_data ?? null
  }

  // Fill template
  const filledContent = fillTemplate(tmpl.content as string, filled_data as Record<string, string>)

  // Generate PDF
  const pdfBuffer = await generateDocumentPDF({
    title: name || (tmpl.name as string),
    content: filledContent,
    signatureDataUrl,
  })

  // Upload to Supabase Storage
  const timestamp = Date.now()
  const safeName = (name || tmpl.name as string).replace(/[^a-z0-9]/gi, '_').toLowerCase()
  const path = `${user.id}/${timestamp}_${safeName}.pdf`

  const { error: uploadErr } = await serviceClient.storage
    .from('documents')
    .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: false })

  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 })
  }

  // Save DB record
  const status = include_signature ? 'signed_by_me' : 'generated'
  const pdfField = include_signature ? 'signed_pdf_path' : 'pdf_path'

  const { data: doc, error: dbErr } = await serviceClient
    .from('documents')
    .insert({
      template_id,
      name:            name || tmpl.name,
      category:        tmpl.category,
      status,
      document_type:   'generated',
      filled_data,
      [pdfField]:      path,
      property_id:     property_id     || null,
      lead_id:         lead_id         || null,
      contact_id:      contact_id      || null,
      deal_id:         deal_id         || null,
      offer_amount:    offer_amount    || null,
      recipient_name:  recipient_name  || null,
      recipient_email: recipient_email || null,
      expires_at:      expires_at      || null,
      created_by:      user.id,
    })
    .select()
    .single()

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json(doc, { status: 201 })
}
