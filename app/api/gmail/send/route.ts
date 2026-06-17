import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { sendEmail, getTokenRecord } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { to, subject, html_body, cc, bcc, contact_id, lead_id, deal_id, property_id, attachments, offer_status } = body

  if (!to || !subject || !html_body) {
    return NextResponse.json({ error: 'to, subject, and html_body are required' }, { status: 400 })
  }

  const token = await getTokenRecord(user.id)
  if (!token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
  }

  try {
    const sent = await sendEmail(user.id, {
      to,
      subject,
      body: html_body,
      cc,
      bcc,
      attachments,
    })

    // Save communication record
    await serviceClient.from('communications').insert({
      type:               'email',
      provider:           'gmail',
      provider_message_id: sent.id,
      thread_id:          sent.threadId,
      direction:          'outbound',
      subject,
      body_preview:       html_body.replace(/<[^>]+>/g, '').slice(0, 500),
      body_full:          html_body,
      from_email:         token.email,
      to_email:           to,
      cc:                 cc ?? null,
      bcc:                bcc ?? null,
      contact_id:         contact_id ?? null,
      lead_id:            lead_id ?? null,
      deal_id:            deal_id ?? null,
      property_id:        property_id ?? null,
      attachment_urls:    attachments ? attachments.map((a: { filename: string }) => a.filename) : [],
      status:             offer_status ?? 'sent',
      sent_at:            new Date().toISOString(),
    })

    return NextResponse.json({ ok: true, messageId: sent.id, threadId: sent.threadId })
  } catch (err) {
    console.error('Gmail send error:', err)
    const msg = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
