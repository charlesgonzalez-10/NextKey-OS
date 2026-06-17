import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { sendEmail, getTokenRecord } from '@/lib/gmail'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

// GET — list signing requests for this document
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data, error } = await serviceClient
    .from('signing_requests')
    .select('id, recipient_email, recipient_name, status, created_at, viewed_at, signed_at, expires_at, token')
    .eq('document_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [] })
}

// POST — create a signing request and send the link via Gmail
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { recipient_email, recipient_name, message, expires_days = 7 } = await req.json()

  if (!recipient_email) return NextResponse.json({ error: 'recipient_email required' }, { status: 400 })

  // Load document
  const { data: doc } = await serviceClient
    .from('documents')
    .select('id, name, pdf_path, signed_pdf_path, file_path')
    .eq('id', id)
    .single()

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const filePath = doc.signed_pdf_path || doc.pdf_path || doc.file_path
  if (!filePath) return NextResponse.json({ error: 'Document has no PDF to sign' }, { status: 400 })

  const expiresAt = new Date(Date.now() + expires_days * 864e5).toISOString()

  // Create signing request
  const { data: sigReq, error: insertErr } = await serviceClient
    .from('signing_requests')
    .insert({
      document_id:     id,
      user_id:         user.id,
      recipient_email,
      recipient_name:  recipient_name || null,
      message:         message || null,
      expires_at:      expiresAt,
    })
    .select()
    .single()

  if (insertErr || !sigReq) return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })

  // Send email with signing link
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nextkeyos.vercel.app'
  const signingUrl = `${baseUrl}/sign/${sigReq.token}`
  const recipientFirst = recipient_name?.split(' ')[0] ?? 'there'

  const emailBody = `
<p>Hi ${recipientFirst},</p>
${message ? `<p>${message}</p>` : ''}
<p>Please review and sign the document <strong>${doc.name}</strong> by clicking the button below:</p>
<p style="margin: 24px 0;">
  <a href="${signingUrl}" style="background:#0A1F44;color:#C9A84C;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">
    Review &amp; Sign Document
  </a>
</p>
<p style="color:#888;font-size:12px;">This link expires ${new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. If you have any questions, simply reply to this email.</p>
  `.trim()

  // Attempt Gmail send — non-fatal if not connected
  let gmailError: string | null = null
  try {
    const token = await getTokenRecord(user.id)
    if (token) {
      await sendEmail(user.id, {
        to:      recipient_email,
        subject: `Please sign: ${doc.name}`,
        body:    emailBody,
      })
    } else {
      gmailError = 'Gmail not connected — signing link created but email not sent.'
    }
  } catch (e) {
    gmailError = e instanceof Error ? e.message : 'Email send failed'
  }

  // Log activity on the document
  await serviceClient.from('document_activity').insert({
    document_id: id,
    action:      'signature_requested',
    notes:       `Signing request sent to ${recipient_email}`,
    created_by:  user.id,
  })

  // Update document status to awaiting_signature
  await serviceClient
    .from('documents')
    .update({ status: 'sent', recipient_email, recipient_name: recipient_name || null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({
    request: sigReq,
    signing_url: signingUrl,
    gmail_error: gmailError,
  }, { status: 201 })
}
