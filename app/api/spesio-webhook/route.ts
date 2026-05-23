import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Use service role key here — this endpoint needs to bypass RLS
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  // Optional: validate shared secret from Spesio
  const secret = request.headers.get('x-spesio-secret')
  if (process.env.SPESIO_WEBHOOK_SECRET && secret !== process.env.SPESIO_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Normalize Spesio payload — adjust field names to match what Spesio sends
  const name = (body.name || body.full_name || body.contact_name || '') as string
  const phone = (body.phone || body.phone_number || '') as string
  const email = (body.email || '') as string
  const address = (body.address || body.property_address || '') as string
  const notes = (body.notes || body.message || body.description || '') as string

  if (!name && !phone) {
    return NextResponse.json({ error: 'Missing name or phone' }, { status: 400 })
  }

  const supabase = getSupabase()

  // Check for duplicate by phone
  if (phone) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('phone', phone)
      .maybeSingle()

    if (existing) {
      // Log as a new activity on existing contact instead of duplicating
      await supabase.from('activities').insert([{
        contact_id: existing.id,
        type: 'note',
        notes: `New Spesio lead received. Address: ${address || 'N/A'}. ${notes}`.trim(),
      }])
      return NextResponse.json({ status: 'duplicate', contact_id: existing.id })
    }
  }

  // Create new contact
  const { data: contact, error } = await supabase
    .from('contacts')
    .insert([{
      name: name || 'Unknown (Spesio)',
      phone,
      email,
      address,
      category: 'Seller',
      status: 'Active',
      source: 'Spesio',
      notes,
      tags: ['spesio'],
    }])
    .select()
    .single()

  if (error) {
    console.error('Spesio webhook insert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log initial activity
  await supabase.from('activities').insert([{
    contact_id: contact.id,
    type: 'note',
    notes: `Lead received from Spesio.io${address ? ` — Property: ${address}` : ''}.${notes ? ` ${notes}` : ''}`,
  }])

  return NextResponse.json({ status: 'created', contact_id: contact.id })
}

// Health check
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'spesio-webhook' })
}
