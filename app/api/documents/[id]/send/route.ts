import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { sendEmail, getTokenRecord } from '@/lib/gmail'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { to, subject, body, cc, contact_id, lead_id, deal_id, property_id } = await req.json()

  if (!to || !subject || !body) {
    return NextResponse.json({ error: 'to, subject, and body required' }, { status: 400 })
  }

  const token = await getTokenRecord(user.id)
  if (!token) return NextResponse.json({ error: 'Gmail not connected. Connect Gmail in Settings.' }, { status: 400 })

  // Load document record
  const { data: doc } = await serviceClient
    .from('documents')
    .select('*')
    .eq('id', id)
    .single()

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const filePath = doc.signed_pdf_path || doc.pdf_path || doc.file_path
  if (!filePath) return NextResponse.json({ error: 'No file to attach' }, { status: 400 })

  // Download file from storage
  const { data: fileData, error: dlErr } = await serviceClient.storage
    .from('documents')
    .download(filePath)

  if (dlErr || !fileData) {
    return NextResponse.json({ error: 'Could not download attachment' }, { status: 500 })
  }

  const buffer = await fileData.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const filename = `${doc.name}.pdf`

  try {
    const sent = await sendEmail(user.id, {
      to,
      subject,
      body,
      cc,
      attachments: [{ filename, mimeType: 'application/pdf', data: base64 }],
    })

    // Update document status + recipient
    await serviceClient
      .from('documents')
      .update({
        status: 'sent',
        recipient_email: to,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    // Log activity
    await serviceClient.from('document_activity').insert({
      document_id: id,
      action: 'sent',
      notes: `Sent to ${to}`,
      created_by: user.id,
    })

    // Save communication record
    await serviceClient.from('communications').insert({
      type: 'email',
      provider: 'gmail',
      provider_message_id: sent.id,
      thread_id: sent.threadId,
      direction: 'outbound',
      subject,
      body_preview: body.replace(/<[^>]+>/g, '').slice(0, 500),
      body_full: body,
      from_email: token.email,
      to_email: to,
      cc: cc ?? null,
      contact_id: contact_id ?? doc.contact_id ?? null,
      lead_id: lead_id ?? doc.lead_id ?? null,
      deal_id: deal_id ?? doc.deal_id ?? null,
      property_id: property_id ?? doc.property_id ?? null,
      attachment_urls: [filename],
      status: 'sent',
      sent_at: new Date().toISOString(),
    })

    return NextResponse.json({ ok: true, messageId: sent.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Send failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
