/**
 * POST /api/properties/save
 *
 * Permanently saves a live REAPI search result into the properties table
 * and creates a leads entry. This is the only way a property from a search
 * result enters the database.
 *
 * Body:
 *   { property: LiveProperty }
 *
 * Response:
 *   { property_id, lead_id, already_existed }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectEntityType } from '@/lib/scrapers/utils'
import type { LiveProperty } from '@/lib/search/reapi-search'
import { lookupCaseNumber } from '@/lib/ingestion/reapi-case-lookup'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  let body: { property?: LiveProperty }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const prop = body.property
  if (!prop) {
    return NextResponse.json({ error: 'property is required' }, { status: 400 })
  }

  const supabase = getSupabase()

  // ── Build the properties row ─────────────────────────────────────────────
  const payload = {
    source:             'reapi',
    data_source:        prop.data_source ?? 'REAPI',
    county:             prop.county      ?? null,
    state:              'FL',
    case_number:        null,   // filled below via PropertyDetail lookup
    folio_number:       prop.folio_number ?? null,
    file_date:          prop.file_date    ?? null,
    plaintiff:          prop.plaintiff    ?? null,
    lender_name:        prop.lender_name  ?? null,
    mortgagor:          prop.mortgagor    ?? null,
    foreclosure_amount: prop.known_debt   ?? null,
    foreclosure_type:   prop.foreclosure_type ?? null,

    is_pre_foreclosure: prop.is_pre_foreclosure,
    is_foreclosure:     prop.is_foreclosure,
    is_auction:         prop.is_auction,
    is_probate:         false,
    is_tax_deed:        false,
    is_divorce:         false,
    multiple_liens:     false,
    free_clear:         prop.free_clear,
    high_equity:        prop.high_equity,

    owner_name:         prop.owner_name       ?? null,
    property_address:   prop.property_address ?? null,
    city:               prop.city             ?? null,
    zip:                prop.zip              ?? null,
    entity_type:        detectEntityType(prop.owner_name ?? '') ?? null,

    beds:               prop.beds         ?? null,
    baths:              prop.baths        ?? null,
    year_built:         prop.year_built   ?? null,
    living_area:        prop.living_area  ?? null,
    lot_size:           prop.lot_size     ?? null,
    property_type:      prop.property_type ?? null,

    assessed_value:       prop.assessed_value      ?? null,
    market_value:         prop.market_value         ?? null,
    known_debt:           prop.known_debt           ?? null,
    equity_percentage:    prop.equity_percentage    ?? null,
    equity_dollar_amount: prop.equity_dollar_amount ?? null,
    equity_tier:          prop.equity_tier,

    homestead:          prop.homestead       ?? null,
    absentee_owner:     prop.absentee_owner  ?? null,

    latitude:           prop.latitude  ?? null,
    longitude:          prop.longitude ?? null,
    subdivision_name:   prop.subdivision_name ?? null,
    suggested_rent:     prop.suggested_rent   ?? null,

    raw_reapi:          prop._raw ?? null,
    updated_at:         new Date().toISOString(),
  }

  // ── Upsert by folio_number (primary dedup key for REAPI properties) ──────
  let propertyId: string
  let alreadyExisted = false

  if (prop.folio_number) {
    const { data: existing } = await supabase
      .from('properties')
      .select('id')
      .eq('folio_number', prop.folio_number)
      .maybeSingle()

    if (existing?.id) {
      alreadyExisted = true
      propertyId = existing.id
      // Update with fresh data
      await supabase.from('properties').update({
        is_pre_foreclosure: payload.is_pre_foreclosure,
        is_foreclosure:     payload.is_foreclosure,
        is_auction:         payload.is_auction,
        market_value:       payload.market_value,
        known_debt:         payload.known_debt,
        equity_percentage:  payload.equity_percentage,
        equity_dollar_amount: payload.equity_dollar_amount,
        equity_tier:        payload.equity_tier,
        file_date:          payload.file_date,
        plaintiff:          payload.plaintiff,
        raw_reapi:          payload.raw_reapi,
        updated_at:         payload.updated_at,
      }).eq('id', propertyId)
    } else {
      const { data: newProp, error } = await supabase
        .from('properties').insert([payload]).select('id').single()
      if (error || !newProp) {
        return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
      }
      propertyId = newProp.id
    }
  } else {
    // No folio — insert as new (REAPI properties should always have an APN,
    // but handle the edge case gracefully)
    const { data: newProp, error } = await supabase
      .from('properties').insert([payload]).select('id').single()
    if (error || !newProp) {
      return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    }
    propertyId = newProp.id
  }

  // ── Look up real court case number from REAPI PropertyDetail ────────────
  // Fires async — if we already have a case number, skip
  if (prop.folio_number && prop.county) {
    const { case_number, foreclosure_history } = await lookupCaseNumber({
      apn:    prop.folio_number,
      county: prop.county,
    })

    if (case_number) {
      await supabase.from('properties').update({
        case_number,
        // Also store the full foreclosure history in raw_reapi extension
        raw_reapi: { ...(prop._raw ?? {}), foreclosureInfo: foreclosure_history },
        updated_at: new Date().toISOString(),
      }).eq('id', propertyId)
    }
  }

  // ── Ensure a leads entry exists ──────────────────────────────────────────
  const { data: existingLead } = await supabase
    .from('leads').select('id').eq('property_id', propertyId).maybeSingle()

  let leadId: string | null = existingLead?.id ?? null

  if (!existingLead) {
    const { data: newLead, error: leadErr } = await supabase
      .from('leads')
      .insert([{ property_id: propertyId, status: 'new', source: 'reapi' }])
      .select('id').single()

    if (leadErr) {
      console.warn('[Properties/Save] leads insert failed:', leadErr.message)
    } else {
      leadId = newLead?.id ?? null
    }
  }

  return NextResponse.json({
    property_id:     propertyId,
    lead_id:         leadId,
    already_existed: alreadyExisted,
  })
}
