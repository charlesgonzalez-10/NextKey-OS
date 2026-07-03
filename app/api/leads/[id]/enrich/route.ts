/**
 * POST /api/leads/[id]/enrich
 *
 * County-agnostic public records enrichment.
 * Routes each property to its correct county Property Appraiser via the
 * provider registry — no county names are hardcoded here.
 *
 * Flow:
 *  1. Fetch property (county, folio, address)
 *  2. Normalize county → canonical registry key
 *  3. Reject unsupported counties with a clear 422 (never silently fall through)
 *  4. Freshness gate (skip if data is still fresh, unless ?force=true)
 *  5. Try folio-based PA lookup first (faster), then address-based
 *  6. Persist discovered folio if property didn't have one
 *  7. Write enriched fields → properties table + lead_enrichments
 *  8. Mark intelligence modules refreshed, record DSOE provenance
 *
 * Query params:
 *  ?force=true  — re-enrich even if data is still fresh
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { normalizeCounty } from '@/lib/property-sources/normalize-county'
import { isCountySupported, tryCountyPASources, tryFolioLookup } from '@/lib/property-sources/registry'
import type { PropertySourceResult } from '@/lib/property-sources/types'
import {
  shouldRefreshModule,
  snapshotBeforeUpdate,
  markModuleRefreshed,
  accumulateMarketData,
} from '@/lib/propertyService'
import { recordFieldSources, logDSOERequest } from '@/lib/dsoe'

export const dynamic = 'force-dynamic'

// ── Map PropertySourceResult fields → properties table columns ────────────────

function buildDbUpdate(r: PropertySourceResult): Record<string, unknown> {
  const u: Record<string, unknown> = {}

  // Ownership
  if (r.owner_name      != null) u.owner_name        = r.owner_name
  if (r.mailing_address != null) u.mailing_address   = r.mailing_address
  if (r.owner_state     != null) u.owner_state       = r.owner_state
  if (r.owner_zip       != null) u.owner_zip         = r.owner_zip

  // Legal / zoning
  if (r.legal_desc  != null) u.legal_description = r.legal_desc
  if (r.zoning      != null) u.zoning            = r.zoning
  if (r.subdivision != null) u.subdivision_name  = r.subdivision

  // Building
  if (r.beds        != null) u.beds        = r.beds
  if (r.baths       != null) u.baths       = r.baths
  if (r.living_area != null) u.living_area = r.living_area
  if (r.year_built  != null) u.year_built  = r.year_built
  if (r.lot_size    != null) u.lot_size    = r.lot_size

  // Valuation
  if (r.market_value    != null) u.market_value    = r.market_value
  if (r.assessed_value  != null) u.assessed_value  = r.assessed_value
  if (r.land_value      != null) u.land_value      = r.land_value
  if (r.building_value  != null) u.build_value     = r.building_value
  if (r.tax_year        != null) u.tax_year        = r.tax_year

  // Sale history
  if (r.last_sale_date   != null) u.last_sale_date = r.last_sale_date
  if (r.last_sale_amount != null) u.sold_price     = r.last_sale_amount

  // Raw PA response
  if (r.raw != null) u.raw_pa = r.raw

  return u
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const url   = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'

  // 1. Fetch property
  const { data: property, error: propErr } = await serviceClient
    .from('properties')
    .select('id, county, folio_number, enriched_at, enrichment_src, property_address, city, state')
    .eq('id', id)
    .single()

  if (propErr || !property) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 })
  }

  // 2. Normalize county
  const normalizedCounty = normalizeCounty(property.county)

  if (!normalizedCounty) {
    return NextResponse.json({
      error: 'County not recognized.',
      county: property.county,
      hint:   'Ensure the property has a county field set (e.g. "Miami-Dade", "Broward", "Palm Beach").',
    }, { status: 422 })
  }

  // 3. Check county has a registered provider
  if (!isCountySupported(normalizedCounty)) {
    return NextResponse.json({
      error:  `Public records enrichment is not yet available for ${property.county} County.`,
      county: normalizedCounty,
      hint:   'Use Deep Enrich (REAPI) for this property, or contact support to request this county.',
    }, { status: 422 })
  }

  // 4. Freshness gate
  if (!force) {
    const needsRefresh = await shouldRefreshModule(id, 'ownership')
    if (!needsRefresh) {
      return NextResponse.json({
        skipped:     true,
        enriched_at: property.enriched_at,
        message:     'Data is fresh — skipped PA call.',
      })
    }
  }

  // 5. Resolve data — folio first (faster, more precise), then address
  let result: PropertySourceResult | null = null

  if (property.folio_number) {
    result = await tryFolioLookup(property.folio_number, normalizedCounty)
  }

  if (!result && property.property_address) {
    result = await tryCountyPASources(
      property.property_address,
      normalizedCounty,
      property.city ?? undefined
    )
  }

  if (!result) {
    return NextResponse.json({
      error:   `${property.county} PA returned no data for this property.`,
      address: property.property_address,
      folio:   property.folio_number,
    }, { status: 404 })
  }

  const now = new Date().toISOString()

  // 6. Persist discovered folio if we didn't already have one
  if (result.folio && !property.folio_number) {
    await serviceClient
      .from('properties')
      .update({ folio_number: result.folio })
      .eq('id', id)
  }

  // 7a. Snapshot before overwriting
  await Promise.all([
    snapshotBeforeUpdate(id, 'ownership', result.source),
    snapshotBeforeUpdate(id, 'valuation', result.source),
  ])

  // 7b. Build update and write to properties
  const update: Record<string, unknown> = {
    enriched_at:    now,
    enrichment_src: result.source,
    updated_at:     now,
    ...buildDbUpdate(result),
  }

  const { error: updateErr } = await serviceClient
    .from('properties')
    .update(update)
    .eq('id', id)

  if (updateErr) console.error('[Enrich] properties update error:', updateErr)

  // 7c. Upsert lead_enrichments
  await serviceClient
    .from('lead_enrichments')
    .upsert(
      {
        lead_id:      id,
        source:       result.source,
        fields_added: Object.keys(update).filter(k => !['enriched_at', 'enrichment_src', 'updated_at', 'raw_pa'].includes(k)),
        raw:          result.raw,
        enriched_at:  now,
      },
      { onConflict: 'lead_id,source' }
    )

  // 8a. Mark intelligence modules refreshed
  await Promise.all([
    markModuleRefreshed(id, 'ownership', result.source),
    markModuleRefreshed(id, 'valuation', result.source),
  ]).catch(() => {})

  // 8b. DSOE field-level provenance
  void recordFieldSources(id, {
    owner_name:       result.owner_name,
    mailing_address:  result.mailing_address,
    owner_state:      result.owner_state,
    owner_zip:        result.owner_zip,
    legal_desc:       result.legal_desc,
    zoning:           result.zoning,
    beds:             result.beds,
    baths:            result.baths,
    living_area:      result.living_area,
    year_built:       result.year_built,
    lot_size:         result.lot_size,
    market_value:     result.market_value,
    assessed_value:   result.assessed_value,
    land_value:       result.land_value,
    building_value:   result.building_value,
    tax_year:         result.tax_year,
    last_sale_date:   result.last_sale_date,
    last_sale_amount: result.last_sale_amount,
  }, {
    source:      result.source,
    sourceType:  result.sourceType,
    sourceLabel: result.sourceDisplayName,
    confidence:  result.confidence / 100,
  })

  void logDSOERequest({
    propertyId:     id,
    tier:           2,
    source:         result.source,
    fieldsResolved: Object.keys(update).length,
    cacheHits:      0,
    countyHits:     Object.keys(update).length,
    premiumHits:    0,
    costCents:      0,
    durationMs:     0,
  })

  // Return updated property
  const { data: updated } = await serviceClient
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()

  accumulateMarketData({
    zip:          updated?.zip,
    city:         updated?.city,
    county:       updated?.county,
    market_value: updated?.market_value,
    propertyId:   id,
    source:       result.source,
  })

  return NextResponse.json({
    ok:             true,
    enriched_at:    now,
    source:         result.source,
    source_display: result.sourceDisplayName,
    county:         normalizedCounty,
    fields_updated: Object.keys(update).filter(k => !['enriched_at', 'enrichment_src', 'updated_at'].includes(k)),
    lead:           updated,
    property:       updated,
    pa_data:        result,
  })
}
