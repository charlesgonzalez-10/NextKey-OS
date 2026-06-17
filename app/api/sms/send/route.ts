import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { NextRequest, NextResponse } from 'next/server'

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { contactId, body } = await req.json()
  if (!contactId || !body?.trim()) {
    return NextResponse.json({ error: 'contactId and body are required' }, { status: 400 })
  }

  const service = serviceClient

  // Get contact phone — use service client to bypass RLS
  const { data: contact, error: cErr } = await service
    .from('contacts')
    .select('id, name, phone')
    .eq('id', contactId)
    .single()
  if (cErr || !contact?.phone) {
    return NextResponse.json({ error: 'Contact not found or has no phone number' }, { status: 404 })
  }

  const accountSid      = process.env.TWILIO_ACCOUNT_SID
  const authToken       = process.env.TWILIO_AUTH_TOKEN
  const fromNumber      = process.env.TWILIO_PHONE_NUMBER
  const messagingService = process.env.TWILIO_MESSAGING_SERVICE_SID

  // If Twilio not configured, save as "mock" message so UI works in dev
  if (!accountSid || !authToken || !fromNumber) {
    const { data: msg } = await service.from('messages').insert({
      contact_id: contactId,
      direction: 'outbound',
      body: body.trim(),
      status: 'mock',
      from_number: '+10000000000',
      to_number: normalizePhone(contact.phone),
    }).select().single()
    return NextResponse.json({ message: msg, warning: 'Twilio not configured — message saved as mock' })
  }

  const toNumber = normalizePhone(contact.phone)

  // Send via Twilio REST
  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        To: toNumber,
        ...(messagingService ? { MessagingServiceSid: messagingService } : { From: fromNumber }),
        Body: body.trim(),
      }).toString(),
    }
  )

  const twilioData = await twilioRes.json()
  const twilioFailed = !twilioRes.ok
  const twilioError = twilioFailed ? (twilioData.message ?? 'Twilio error') : null

  // Always save to DB via service client — bypasses RLS
  const { data: msg, error: mErr } = await service.from('messages').insert({
    contact_id: contactId,
    direction: 'outbound',
    body: body.trim(),
    status: twilioFailed ? 'failed' : 'sent',
    twilio_sid: twilioFailed ? null : twilioData.sid,
    from_number: fromNumber,
    to_number: toNumber,
  }).select().single()

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  // Return the saved message — include Twilio error as warning so UI can show it
  return NextResponse.json({
    message: msg,
    ...(twilioError ? { warning: twilioError } : {}),
  })
}
