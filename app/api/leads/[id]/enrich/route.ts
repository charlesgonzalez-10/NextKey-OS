/**
 * POST /api/leads/[id]/enrich
 *
 * Triggers Miami-Dade PA enrichment for a property.
 * [id] = properties.id (same UUID as old scraper_leads.id)
 *
 * On success:
 *  - updates properties with enriched fields
 *  - upserts a record in lead_enrichments (lead_id = properties.id)
 *  - returns the full updated property
 *
 * Query params:
 *  ?force=true  — re-enrich even if already enriched
 */
import { serviceClient } from '@/lib/supabase-service'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enrichFromMiamiDadePA, findFolioByAddressGIS } from '@/lib/enrichment/miami-dade-pa'
import {
  shouldRefreshModule,
  snapshotBeforeUpdate,
  markModuleRefreshed,
  accumulateMarketData,
} from '@/lib/propertyService'

export const dynamic = 'force-dynamic'

const service = serviceClient

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

  // Fetch property
  const { data: property, error: propErr } = await service
    .from('properties')
    .select('id, county, folio_number, enriched_at, enrichment_src, property_address, city')
    .eq('id', id)
    .single()

  if (propErr || !property) return NextResponse.json({ error: 'Property not found' }, { status: 404 })

  // Only Miami-Dade PA enrichment supported right now
  if (property.county !== 'miami-dade') {
    return NextResponse.json({
      error: 'Enrichment via Miami-Dade PA is only available for Miami-Dade properties.',
      county: property.county,
    }, { status: 422 })
  }

  // Skip if module is still fresh (uses property_freshness TTL, falls back to enriched_at check)
  if (!force) {
    const needsRefresh = await shouldRefreshModule(id, 'ownership')
    if (!needsRefresh) {
      return NextResponse.json({ skipped: true, enriched_at: property.enriched_at, message: 'Data is fresh — skipped PA call.' })
    }
  }

  // ── Resolve folio ──────────────────────────────────────────────────────────
  let folio: string | null = property.folio_number ?? null

  if (!folio && property.property_address) {
    console.log(`[Enrich] No folio for ${id} — GIS lookup for: ${property.property_address}`)
    const found = await findFolioByAddressGIS(property.property_address)
    if (found?.folio) {
      folio = found.folio
      // Persist the discovered folio
      await service.from('properties').update({ folio_number: folio }).eq('id', id)
      console.log(`[Enrich] GIS found folio ${folio} for property ${id}`)
    }
  }

  if (!folio) {
    return NextResponse.json({
      error: 'Could not find a folio number via GIS. Property may not be in Miami-Dade system.',
      address: property.property_address,
    }, { status: 404 })
  }

  // ── Call PA API ────────────────────────────────────────────────────────────
  let result
  try {
    result = await enrichFromMiamiDadePA(folio)
  } catch (err) {
    console.error('[Enrich] PA API error:', err)
    return NextResponse.json({ error: 'Miami-Dade PA API call failed.' }, { status: 502 })
  }

  if (!result) {
    return NextResponse.json({ error: 'PA API returned no data for this folio.', folio }, { status: 404 })
  }

  // Snapshot current ownership/valuation values before overwriting
  await snapshotBeforeUpdate(id, 'ownership', 'miami-dade-pa')
  await snapshotBeforeUpdate(id, 'valuation', 'miami-dade-pa')

  // ── Update properties table ────────────────────────────────────────────────
  const update: Record<string, unknown> = {
    enriched_at:    new Date().toISOString(),
    enrichment_src: 'miami-dade-pa',
    updated_at:     new Date().toISOString(),
  }

  if (result.owner_name)       update.owner_name        = result.owner_name
  if (result.mailing_address)  update.mailing_address   = result.mailing_address
  if (result.owner_state)      update.owner_state       = result.owner_state
  if (result.owner_zip)        update.owner_zip         = result.owner_zip
  if (result.legal_desc)       update.legal_description = result.legal_desc
  if (result.zoning)           update.zoning            = result.zoning
  if (result.subdivision)      update.subdivision_name  = result.subdivision
  if (result.last_sale_date)   update.last_sale_date    = result.last_sale_date
  if (result.last_sale_amount) update.sold_price        = result.last_sale_amount
  if (result.tax_year)         update.tax_year          = result.tax_year
  if (result.market_value)     update.market_value      = result.market_value
  if (result.assessed_value)   update.assessed_value    = result.assessed_value
  if (result.land_value)       update.land_value        = result.land_value
  if (result.building_value)   update.build_value       = result.building_value
  if (result.beds !== null)        update.beds        = result.beds
  if (result.baths !== null)       update.baths       = result.baths
  if (result.living_area !== null) update.living_area = result.living_area
  if (result.year_built !== null)  update.year_built  = result.year_built
  if (result.lot_size !== null)    update.lot_size    = result.lot_size

  // Store raw PA response
  if (result.raw) update.raw_pa = result.raw

  const { error: updateErr } = await service
    .from('properties')
    .update(update)
    .eq('id', id)

  if (updateErr) console.error('[Enrich] properties update error:', updateErr)

  // ── Store in lead_enrichments (lead_id = properties.id) ───────────────────
  await service
    .from('lead_enrichments')
    .upsert(
      {
        lead_id:      id,  // lead_id FK now points to properties.id after migration
        source:       'miami-dade-pa',
        fields_added: Object.keys(update).filter(k => !['enriched_at','enrichment_src','updated_at','raw_pa'].includes(k)),
        raw:          result.raw,
        enriched_at:  new Date().toISOString(),
      },
      { onConflict: 'lead_id,source' }
    )

  // Mark modules as refreshed in the intelligence layer
  await Promise.all([
    markModuleRefreshed(id, 'ownership', 'miami-dade-pa'),
    markModuleRefreshed(id, 'valuation', 'miami-dade-pa'),
  ]).catch(() => {})

  // Return updated property
  const { data: updated } = await service
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()

  // Accumulate market intelligence (fire-and-forget)
  accumulateMarketData({
    zip:          updated?.zip,
    city:         updated?.city,
    county:       updated?.county,
    market_value: updated?.market_value,
    propertyId:   id,
    source:       'miami-dade-pa',
  })

  return NextResponse.json({
    ok: true,
    enriched_at:    update.enriched_at,
    fields_updated: Object.keys(update).filter(k => !['enriched_at','enrichment_src','updated_at'].includes(k)),
    lead:           updated,  // keep 'lead' key for backward compat with LeadDetailClient
    property:       updated,
    pa_data:        result,
  })
}
