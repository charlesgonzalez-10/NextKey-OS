/**
 * POST /api/properties/deep-enrich/[id]
 *
 * Calls REAPI for AVM, mortgage, phone enrichment on a specific property.
 * Only invoked when the user explicitly clicks the "Deep Enrich" button in the UI.
 * This supplements free county PA data with paid REAPI data.
 *
 * Flow:
 *  1. Authenticate — requires a logged-in user (account_id for billing)
 *  2. Fetch the property record from DB (properties table)
 *  3. Check freshness gate — skip REAPI if data was recently refreshed
 *  4. Call REAPI via providerGateway (customer_shared pool)
 *  5. Merge REAPI fields into the existing record
 *  6. Save enriched data back to DB
 *  7. Return the updated PropertySearchResult
 *
 * Returns 402 if billing authorization is blocked (budget/credits exhausted).
 */

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getPropertyByAPN, getPropertyDetailByAddress } from '@/lib/enrichment/reapi'
import { detectCounty } from '@/lib/enrichment/property-search'
import { buildCustomerContext } from '@/lib/billing/gatewayContext'
import type { County } from '@/lib/enrichment/types'
import { NextResponse } from 'next/server'
import {
  shouldRefreshModule,
  snapshotBeforeUpdate,
  markModuleRefreshed,
  accumulateMarketData,
} from '@/lib/propertyService'

function getService() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Authenticate — account_id is required for billing
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await (req as Request & { json?: () => Promise<Record<string, unknown>> }).json?.().catch(() => ({})) ?? {}
  const force = (body as Record<string, unknown>).force === true

  // 2. Fetch the property from DB
  const { data: property, error: fetchErr } = await getService()
    .from('properties')
    .select('id, county, folio_number, property_address, city, enriched_at, enrichment_src')
    .eq('id', id)
    .single()

  if (fetchErr || !property) {
    return NextResponse.json(
      { error: 'Property not found', detail: fetchErr?.message },
      { status: 404 }
    )
  }

  const county  = ((property.county as County) ?? detectCounty(property.property_address ?? '')) as County
  const address = property.property_address ?? ''
  const folio   = property.folio_number ?? null

  // 3. Freshness gate — skip REAPI if data was refreshed recently
  const needsRefresh = await shouldRefreshModule(id, 'valuation', { force })
  if (!needsRefresh) {
    const { data: cached } = await getService()
      .from('properties')
      .select('*')
      .eq('id', id)
      .single()
    return NextResponse.json({
      result:         cached,
      updated:        cached,
      fields_updated: [],
      cached:         true,
      message:        'Data is fresh — skipped REAPI call',
    })
  }

  // 4. Call REAPI via gateway — customer_shared pool, charged to user's account
  const billing = buildCustomerContext(user.id)
  let reapiResult = null

  if (folio) {
    const outcome = await getPropertyByAPN(folio, county, billing)
    if (outcome.outcome === 'blocked') {
      return NextResponse.json(
        { error: outcome.safe_message, error_code: outcome.error_code },
        { status: 402 }
      )
    }
    if (outcome.outcome === 'provider_failed') {
      console.error('[DeepEnrich] REAPI APN call failed:', outcome.error)
      return NextResponse.json({ error: 'REAPI enrichment failed' }, { status: 502 })
    }
    reapiResult = outcome.data
  }

  if (!reapiResult && address) {
    const outcome = await getPropertyDetailByAddress(address, county, billing)
    if (outcome.outcome === 'blocked') {
      return NextResponse.json(
        { error: outcome.safe_message, error_code: outcome.error_code },
        { status: 402 }
      )
    }
    if (outcome.outcome === 'provider_failed') {
      console.error('[DeepEnrich] REAPI address call failed:', outcome.error)
      return NextResponse.json({ error: 'REAPI enrichment failed' }, { status: 502 })
    }
    reapiResult = outcome.data
  }

  if (!reapiResult) {
    return NextResponse.json(
      { error: 'REAPI returned no data for this property' },
      { status: 404 }
    )
  }

  // 5. Snapshot current values before overwriting
  await snapshotBeforeUpdate(id, 'valuation',  'reapi')
  await snapshotBeforeUpdate(id, 'ownership',  'reapi')
  await snapshotBeforeUpdate(id, 'mortgage',   'reapi')

  // 6. Merge and save — only update fields that REAPI filled in
  const updates: Record<string, unknown> = {
    enrichment_src: 'reapi',
    enriched_at:    new Date().toISOString(),
  }

  const fieldMap: Record<string, unknown> = {
    folio_number:     reapiResult.folio,
    owner_name:       reapiResult.owner_name,
    mailing_address:  reapiResult.mailing_address,
    owner_state:      reapiResult.owner_state,
    owner_zip:        reapiResult.owner_zip,
    beds:             reapiResult.beds,
    baths:            reapiResult.baths,
    living_area:      reapiResult.living_area,
    lot_size:         reapiResult.lot_size,
    year_built:       reapiResult.year_built,
    market_value:     reapiResult.market_value,
    assessed_value:   reapiResult.assessed_value,
    land_value:       reapiResult.land_value,
    building_value:   reapiResult.building_value,
    last_sale_date:   reapiResult.last_sale_date,
    last_sale_amount: reapiResult.last_sale_amount,
  }

  for (const [col, val] of Object.entries(fieldMap)) {
    if (val != null) updates[col] = val
  }

  const { data: updated, error: saveErr } = await getService()
    .from('properties')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (saveErr) {
    console.error('[DeepEnrich] Failed to save enrichment:', saveErr)
  }

  // 7. Mark modules refreshed
  await Promise.all([
    markModuleRefreshed(id, 'valuation', 'reapi'),
    markModuleRefreshed(id, 'ownership', 'reapi'),
    markModuleRefreshed(id, 'mortgage',  'reapi'),
  ]).catch(() => {})

  accumulateMarketData({
    zip:          updated?.zip,
    city:         updated?.city,
    county:       updated?.county,
    market_value: updated?.market_value,
    propertyId:   id,
    source:       'reapi',
  })

  const enrichedResult = {
    ...reapiResult,
    source_display:    'RealEstateAPI.com (Deep Enrich)',
    source_type:       'paid' as const,
    source_confidence: 95,
    source_checked_at: new Date().toISOString(),
    needs_enrichment:  false,
  }

  return NextResponse.json({
    result:         enrichedResult,
    updated:        updated ?? null,
    fields_updated: Object.keys(updates).filter(k => k !== 'enriched_at' && k !== 'enrichment_src'),
  })
}
