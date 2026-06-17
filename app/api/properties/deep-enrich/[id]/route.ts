/**
 * POST /api/properties/deep-enrich/[id]
 *
 * Calls REAPI for AVM, mortgage, phone enrichment on a specific property.
 * Only invoked when the user explicitly clicks the "Deep Enrich" button in the UI.
 * This supplements free county PA data with paid REAPI data.
 *
 * Flow:
 *  1. Fetch the property record from DB (properties table)
 *  2. Call REAPI with its APN/folio or address
 *  3. Merge REAPI fields into the existing record (don't overwrite non-null PA fields)
 *  4. Save enriched data back to DB
 *  5. Return the updated PropertySearchResult
 */

import { createClient } from '@supabase/supabase-js'
import { getPropertyByAPN, getPropertyDetailByAddress } from '@/lib/enrichment/reapi'
import { detectCounty } from '@/lib/enrichment/property-search'
import type { County } from '@/lib/enrichment/types'
import { NextResponse } from 'next/server'
import {
  shouldRefreshModule,
  snapshotBeforeUpdate,
  markModuleRefreshed,
  accumulateMarketData,
} from '@/lib/propertyService'

// Lazy init — avoids "supabaseUrl is required" at Next.js build-time module evaluation
function getService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await (req as Request & { json?: () => Promise<Record<string, unknown>> }).json?.().catch(() => ({})) ?? {}
  const force = (body as Record<string, unknown>).force === true

  if (!process.env.REAPI_KEY) {
    return NextResponse.json(
      { error: 'Deep Enrich requires REAPI_KEY — not configured' },
      { status: 503 }
    )
  }

  // 1. Fetch the property from DB
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

  const county = ((property.county as County) ?? detectCounty(property.property_address ?? '')) as County
  const address = property.property_address ?? ''
  const folio   = property.folio_number ?? null

  // 1b. Check freshness — skip REAPI if data was enriched recently
  const needsRefresh = await shouldRefreshModule(id, 'valuation', { force })
  if (!needsRefresh) {
    const { data: cached } = await getService()
      .from('properties')
      .select('*')
      .eq('id', id)
      .single()
    return NextResponse.json({
      result:  cached,
      updated: cached,
      fields_updated: [],
      cached: true,
      message: 'Data is fresh — skipped REAPI call',
    })
  }

  // 2. Call REAPI
  let reapiResult = null
  try {
    if (folio) {
      reapiResult = await getPropertyByAPN(folio, county)
    }
    if (!reapiResult && address) {
      reapiResult = await getPropertyDetailByAddress(address, county)
    }
  } catch (err) {
    console.error('[DeepEnrich] REAPI call failed:', err)
    return NextResponse.json(
      { error: 'REAPI enrichment failed', detail: String(err) },
      { status: 502 }
    )
  }

  if (!reapiResult) {
    return NextResponse.json(
      { error: 'REAPI returned no data for this property' },
      { status: 404 }
    )
  }

  // 3. Snapshot current values before overwriting
  await snapshotBeforeUpdate(id, 'valuation',  'reapi')
  await snapshotBeforeUpdate(id, 'ownership',  'reapi')
  await snapshotBeforeUpdate(id, 'mortgage',   'reapi')

  // 4. Merge and save — only update fields that REAPI filled in
  const updates: Record<string, unknown> = {
    enrichment_src: 'reapi',
    enriched_at:    new Date().toISOString(),
  }

  // Map REAPI result fields to DB columns (only overwrite nulls with real values)
  const fieldMap: Record<string, unknown> = {
    folio_number:    reapiResult.folio,
    owner_name:      reapiResult.owner_name,
    mailing_address: reapiResult.mailing_address,
    owner_state:     reapiResult.owner_state,
    owner_zip:       reapiResult.owner_zip,
    beds:            reapiResult.beds,
    baths:           reapiResult.baths,
    living_area:     reapiResult.living_area,
    lot_size:        reapiResult.lot_size,
    year_built:      reapiResult.year_built,
    market_value:    reapiResult.market_value,
    assessed_value:  reapiResult.assessed_value,
    land_value:      reapiResult.land_value,
    building_value:  reapiResult.building_value,
    last_sale_date:  reapiResult.last_sale_date,
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

  // 4b. Mark modules as refreshed in the intelligence layer
  await Promise.all([
    markModuleRefreshed(id, 'valuation', 'reapi'),
    markModuleRefreshed(id, 'ownership', 'reapi'),
    markModuleRefreshed(id, 'mortgage',  'reapi'),
  ]).catch(() => {})

  // 4c. Accumulate market intelligence
  accumulateMarketData({
    zip:          updated?.zip,
    city:         updated?.city,
    county:       updated?.county,
    market_value: updated?.market_value,
    propertyId:   id,
    source:       'reapi',
  })

  // 5. Return the enriched result with provenance metadata
  const enrichedResult = {
    ...reapiResult,
    source_display:    'RealEstateAPI.com (Deep Enrich)',
    source_type:       'paid' as const,
    source_confidence: 95,
    source_checked_at: new Date().toISOString(),
    needs_enrichment:  false,
  }

  return NextResponse.json({
    result:  enrichedResult,
    updated: updated ?? null,
    fields_updated: Object.keys(updates).filter(k => k !== 'enriched_at' && k !== 'enrichment_src'),
  })
}
