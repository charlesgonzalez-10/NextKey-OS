/**
 * POST /api/properties/upsert
 *
 * Saves a property to the database without creating a lead record.
 * Used by the search results page to get a canonical property_id before
 * navigating to /properties/[id]. Idempotent — deduplicates by folio_number.
 *
 * Body: { property: Lead } — the normalized search result shape
 * Response: { property_id, already_existed }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: { property?: Record<string, any> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const prop = body.property
  if (!prop) {
    return NextResponse.json({ error: 'property is required' }, { status: 400 })
  }

  const folioNumber: string | null = prop.folio_number ?? prop.folio ?? null

  const supabase = getSupabase()

  // ── Dedup by folio_number — return existing property_id if already in DB ──
  if (folioNumber) {
    const { data: existing } = await supabase
      .from('properties')
      .select('id')
      .eq('folio_number', folioNumber)
      .maybeSingle()

    if (existing?.id) {
      // Refresh lightweight fields so data is fresh
      await supabase.from('properties').update({
        owner_name:    prop.owner_name    ?? null,
        market_value:  prop.market_value  ?? null,
        assessed_value: prop.assessed_value ?? null,
        updated_at:    new Date().toISOString(),
      }).eq('id', existing.id)

      return NextResponse.json({ property_id: existing.id, already_existed: true })
    }
  }

  // ── Insert new property row (no lead created) ─────────────────────────────
  const payload = {
    source:           prop.data_source ?? 'search',
    data_source:      prop.data_source ?? null,
    county:           prop.county      ?? null,
    state:            'FL',
    folio_number:     folioNumber,
    owner_name:       prop.owner_name        ?? null,
    property_address: prop.property_address  ?? null,
    city:             prop.city              ?? null,
    zip:              prop.zip               ?? null,
    beds:             prop.beds              ?? null,
    baths:            prop.baths             ?? null,
    year_built:       prop.year_built        ?? null,
    living_area:      prop.living_area       ?? null,
    assessed_value:   prop.assessed_value    ?? null,
    market_value:     prop.market_value      ?? null,
    equity_percentage: prop.equity_percentage ?? null,
    equity_tier:      prop.equity_tier       ?? null,
    absentee_owner:   prop.absentee_owner    ?? null,
    is_pre_foreclosure: prop.is_pre_foreclosure ?? false,
    is_probate:       prop.is_probate        ?? false,
    is_tax_deed:      prop.is_tax_deed       ?? false,
    is_auction:       prop.is_auction        ?? false,
    free_clear:       prop.free_clear        ?? false,
    case_number:      prop.case_number       ?? null,
    file_date:        prop.file_date         ?? null,
    last_sale_date:   prop.last_sale_date    ?? null,
    last_sale_amount: prop.last_sale_amount  ?? null,
    annual_taxes:     prop.annual_taxes      ?? null,
    updated_at:       new Date().toISOString(),
  }

  const { data: newProp, error } = await supabase
    .from('properties')
    .insert([payload])
    .select('id')
    .single()

  if (error || !newProp) {
    return NextResponse.json(
      { error: error?.message ?? 'Insert failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ property_id: newProp.id, already_existed: false })
}
