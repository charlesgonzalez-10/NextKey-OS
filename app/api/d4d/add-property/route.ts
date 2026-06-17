import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { address, city, zip, lat, lng, condition, notes, session_id } = await req.json()

  if (!address) return NextResponse.json({ error: 'address is required' }, { status: 400 })

  // Check for duplicate by address
  const { data: existing } = await serviceClient
    .from('properties')
    .select('id')
    .ilike('property_address', address.trim())
    .maybeSingle()

  let propertyId: string

  if (existing?.id) {
    propertyId = existing.id
    // Update D4D fields if new info provided
    await serviceClient.from('properties').update({
      d4d_condition: condition ?? null,
      d4d_notes:     notes     ?? null,
      d4d_session_id: session_id ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', propertyId)
  } else {
    const { data: newProp, error } = await serviceClient
      .from('properties')
      .insert([{
        source:           'd4d',
        data_source:      'D4D',
        state:            'FL',
        property_address: address.trim(),
        city:             city   ?? null,
        zip:              zip    ?? null,
        latitude:         lat    ?? null,
        longitude:        lng    ?? null,
        d4d_condition:    condition ?? null,
        d4d_notes:        notes     ?? null,
        d4d_session_id:   session_id ?? null,
        is_pre_foreclosure: false,
        is_foreclosure:     false,
        is_auction:         false,
        is_probate:         false,
        is_tax_deed:        false,
        is_divorce:         false,
        multiple_liens:     false,
        updated_at: new Date().toISOString(),
      }])
      .select('id')
      .single()

    if (error || !newProp) {
      return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    }
    propertyId = newProp.id
  }

  // Ensure lead entry exists
  const { data: existingLead } = await serviceClient
    .from('leads')
    .select('id')
    .eq('property_id', propertyId)
    .maybeSingle()

  let leadId: string | null = existingLead?.id ?? null

  if (!existingLead) {
    const { data: newLead } = await serviceClient
      .from('leads')
      .insert([{ property_id: propertyId, status: 'new', source: 'd4d' }])
      .select('id')
      .single()
    leadId = newLead?.id ?? null
  }

  // Increment session lead count if session active
  if (session_id) {
    const { data: sess } = await serviceClient
      .from('d4d_sessions')
      .select('lead_count')
      .eq('id', session_id)
      .single()
    if (sess) {
      await serviceClient
        .from('d4d_sessions')
        .update({ lead_count: (sess.lead_count ?? 0) + 1 })
        .eq('id', session_id)
    }
  }

  return NextResponse.json({ property_id: propertyId, lead_id: leadId, already_existed: !!existing })
}
