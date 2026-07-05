/**
 * GET  /api/leads/[id]/comms/sms  — fetch SMS messages for lead's contacts
 * POST /api/leads/[id]/comms/sms  — send SMS via Twilio (proxies to /api/sms/send, adds lead_id)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // `id` is properties.id (see app/api/leads/[id]/contacts/route.ts for why).
  const { id: leadId } = await params
  const contactId = req.nextUrl.searchParams.get('contact_id')

  // Get contact IDs linked to this property
  const { data: linked } = await serviceClient
    .from('contact_properties')
    .select('contact_id')
    .eq('property_id', leadId)

  const contactIds = linked?.map(l => l.contact_id) ?? []
  if (contactIds.length === 0) return NextResponse.json({ messages: [] })

  const filteredIds = contactId ? [contactId] : contactIds

  const { data, error } = await serviceClient
    .from('messages')
    .select('id, contact_id, direction, body, status, from_number, to_number, created_at')
    .in('contact_id', filteredIds)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ messages: data ?? [] })
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: leadId } = await params
  const { contactId, body } = await req.json()

  if (!contactId || !body?.trim()) {
    return NextResponse.json({ error: 'contactId and body required' }, { status: 400 })
  }

  const { data: contact } = await serviceClient
    .from('contacts')
    .select('id, name, phone')
    .eq('id', contactId)
    .single()

  if (!contact?.phone) {
    return NextResponse.json({ error: 'Contact has no phone number' }, { status: 404 })
  }

  const accountSid       = process.env.TWILIO_ACCOUNT_SID
  const authToken        = process.env.TWILIO_AUTH_TOKEN
  const fromNumber       = process.env.TWILIO_PHONE_NUMBER
  const messagingService = process.env.TWILIO_MESSAGING_SERVICE_SID
  const toNumber         = normalizePhone(contact.phone)

  if (!accountSid || !authToken || !fromNumber) {
    const { data: msg } = await serviceClient.from('messages').insert({
      contact_id: contactId,
      lead_id: leadId,
      direction: 'outbound',
      body: body.trim(),
      status: 'mock',
      from_number: '+10000000000',
      to_number: toNumber,
    }).select().single()
    return NextResponse.json({ message: msg, warning: 'Twilio not configured — saved as mock' })
  }

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
  const failed     = !twilioRes.ok

  const { data: msg, error } = await serviceClient.from('messages').insert({
    contact_id: contactId,
    lead_id: leadId,
    direction: 'outbound',
    body: body.trim(),
    status: failed ? 'failed' : 'sent',
    twilio_sid: failed ? null : twilioData.sid,
    from_number: fromNumber,
    to_number: toNumber,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log to communications table
  await serviceClient.from('communications').insert({
    type: 'sms', provider: 'twilio', direction: 'outbound',
    body_preview: body.trim().slice(0, 300),
    contact_id: contactId, lead_id: leadId,
    status: failed ? 'failed' : 'sent',
    sent_at: new Date().toISOString(),
  })

  return NextResponse.json({ message: msg, ...(failed ? { warning: twilioData.message } : {}) })
}
