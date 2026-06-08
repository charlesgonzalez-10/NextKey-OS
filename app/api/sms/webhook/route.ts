import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

// Twilio sends POST with application/x-www-form-urlencoded
export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = new URLSearchParams(body)

  const fromRaw  = params.get('From') ?? ''
  const toRaw    = params.get('To') ?? ''
  const msgBody  = params.get('Body') ?? ''
  const twilioSid = params.get('MessageSid') ?? ''

  if (!fromRaw || !msgBody) {
    return new NextResponse('<Response/>', { headers: { 'Content-Type': 'text/xml' } })
  }

  const supabase = await createClient()

  // Find contact by phone — try several normalizations
  const fromNorm = normalizePhone(fromRaw)
  const digits10 = fromNorm.replace(/\D/g, '').slice(-10)

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, phone')

  const contact = contacts?.find(c => {
    if (!c.phone) return false
    const cd = c.phone.replace(/\D/g, '').slice(-10)
    return cd === digits10
  })

  const { error } = await supabase.from('messages').insert({
    contact_id: contact?.id ?? null,
    direction: 'inbound',
    body: msgBody,
    status: 'received',
    twilio_sid: twilioSid,
    from_number: fromRaw,
    to_number: toRaw,
  })

  if (error) console.error('Error saving inbound message:', error)

  // Return empty TwiML — no auto-reply for now (AI reply is manual from inbox)
  return new NextResponse('<Response/>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}
