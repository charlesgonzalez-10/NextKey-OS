/**
 * GET /api/leads/[id]/listing
 *
 * Returns MLS listing data for a property.
 * Sources (in priority order):
 *   1. properties table mls_* columns (if already saved)
 *   2. raw_reapi JSONB column (extract MLS fields from stored REAPI response)
 *
 * POST /api/leads/[id]/listing
 *   Body: { fetch_fresh?: boolean }
 *   Fetches fresh REAPI listing data and saves to properties table.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import {
  shouldRefreshModule,
  snapshotBeforeUpdate,
  markModuleRefreshed,
  accumulateMarketData,
} from '@/lib/propertyService'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: prop } = await serviceClient
    .from('properties')
    .select(`
      id, property_address, city, state, zip, folio_number, county,
      mls_status, mls_listing_price, mls_active, mls_number,
      mls_dom, mls_cdom, mls_price_reductions, mls_original_price,
      mls_agent_name, mls_agent_phone, mls_agent_email, mls_broker_name,
      mls_photos, mls_remarks_public, mls_remarks_private,
      mls_showing_instructions, mls_hoa_amount,
      mls_price_history, mls_open_houses, mls_features,
      market_value, assessed_value, tax_amount, tax_year,
      beds, baths, sqft, living_area, year_built, lot_size, property_type,
      raw_reapi, enrichment_src
    `)
    .eq('id', id)
    .single()

  if (!prop) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Extract additional MLS fields from raw_reapi if available
  const raw = prop.raw_reapi as Record<string, unknown> | null
  const mlsData = extractMlsFromRaw(raw)

  // Merge: explicit columns take priority over raw extraction
  const listing = {
    has_listing: !!(prop.mls_status || mlsData.mls_status || prop.mls_active || mlsData.mls_active),
    mls_status:            prop.mls_status            ?? mlsData.mls_status      ?? null,
    mls_number:            prop.mls_number            ?? mlsData.mls_number      ?? null,
    mls_listing_price:     prop.mls_listing_price     ?? mlsData.mls_listing_price ?? null,
    mls_original_price:    prop.mls_original_price    ?? mlsData.mls_original_price ?? null,
    mls_active:            prop.mls_active            ?? mlsData.mls_active      ?? false,
    mls_dom:               prop.mls_dom               ?? mlsData.mls_dom         ?? null,
    mls_cdom:              prop.mls_cdom              ?? mlsData.mls_cdom        ?? null,
    mls_price_reductions:  prop.mls_price_reductions  ?? mlsData.mls_price_reductions ?? null,
    mls_agent_name:        prop.mls_agent_name        ?? mlsData.mls_agent_name  ?? null,
    mls_agent_phone:       prop.mls_agent_phone       ?? mlsData.mls_agent_phone ?? null,
    mls_agent_email:       prop.mls_agent_email       ?? mlsData.mls_agent_email ?? null,
    mls_broker_name:       prop.mls_broker_name       ?? mlsData.mls_broker_name ?? null,
    mls_photos:            prop.mls_photos            ?? mlsData.mls_photos      ?? [],
    mls_remarks_public:    prop.mls_remarks_public    ?? mlsData.mls_remarks_public ?? null,
    mls_remarks_private:   prop.mls_remarks_private   ?? mlsData.mls_remarks_private ?? null,
    mls_showing_instructions: prop.mls_showing_instructions ?? mlsData.mls_showing_instructions ?? null,
    mls_hoa_amount:        prop.mls_hoa_amount        ?? mlsData.mls_hoa_amount  ?? null,
    mls_price_history:     prop.mls_price_history     ?? mlsData.mls_price_history ?? [],
    mls_open_houses:       prop.mls_open_houses       ?? mlsData.mls_open_houses ?? [],
    mls_features:          prop.mls_features          ?? mlsData.mls_features    ?? null,
    // Property info
    address: prop.property_address,
    city:    prop.city,
    state:   prop.state,
    zip:     prop.zip,
    folio:   prop.folio_number,
    county:  prop.county,
    beds:    prop.beds,
    baths:   prop.baths,
    sqft:    prop.sqft ?? prop.living_area,
    year_built: prop.year_built,
    lot_size:   prop.lot_size,
    property_type: prop.property_type,
    tax_amount: prop.tax_amount,
    tax_year:   prop.tax_year,
    market_value: prop.market_value,
    // Realtor.com link (constructed from address)
    realtor_url: buildRealtorUrl(prop.property_address, prop.city, prop.state, prop.zip),
    data_source: prop.enrichment_src,
  }

  return NextResponse.json({ listing })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  if (!body.fetch_fresh) return NextResponse.json({ ok: true })

  // Check MLS freshness — active listings refresh daily, others weekly
  const { data: mlsMeta } = await serviceClient
    .from('properties')
    .select('mls_active')
    .eq('id', id)
    .single()
  const isActive     = mlsMeta?.mls_active === true
  const needsRefresh = await shouldRefreshModule(id, 'mls', { isActiveListing: isActive })
  if (!needsRefresh && !body.force) {
    return NextResponse.json({ ok: true, cached: true, message: 'MLS data is fresh' })
  }

  const key = process.env.REAPI_KEY
  if (!key) return NextResponse.json({ error: 'REAPI not configured' }, { status: 503 })

  const { data: prop } = await serviceClient
    .from('properties')
    .select('property_address, folio_number')
    .eq('id', id)
    .single()

  if (!prop) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const searchBody: Record<string, unknown> = { size: 1, mlsListingActive: true }
  if (prop.folio_number) searchBody.apn = prop.folio_number.replace(/\D/g, '')
  else searchBody.address = prop.property_address

  const res = await fetch('https://api.realestateapi.com/v2/PropertySearch', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body:    JSON.stringify(searchBody),
    signal:  AbortSignal.timeout(12_000),
  })

  if (!res.ok) return NextResponse.json({ error: `REAPI ${res.status}` }, { status: 502 })

  const data = await res.json()
  const raw  = data.data?.[0]
  if (!raw)   return NextResponse.json({ listing: null })

  // Extract and save MLS fields from REAPI response
  const updates: Record<string, unknown> = {
    mls_status:        raw.mlsStatus        ?? null,
    mls_listing_price: raw.mlsListingPrice  ?? null,
    mls_active:        raw.mlsActive        ?? false,
    mls_dom:           raw.daysOnMarket     ?? null,
    raw_reapi:         raw,
    enrichment_src:    'reapi',
  }

  await snapshotBeforeUpdate(id, 'mls', 'reapi')
  await serviceClient.from('properties').update(updates).eq('id', id)
  await markModuleRefreshed(id, 'mls', 'reapi').catch(() => {})

  accumulateMarketData({
    mls_listing_price:    raw.mlsListingPrice ?? null,
    mls_dom:              raw.daysOnMarket ?? null,
    mls_price_reductions: raw.priceReductions ?? null,
    propertyId: id,
    source:     'reapi',
  })

  return NextResponse.json({ ok: true, updates_count: Object.keys(updates).length })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractMlsFromRaw(raw: Record<string, unknown> | null): Record<string, unknown> {
  if (!raw) return {}
  return {
    mls_status:           raw.mlsStatus           ?? null,
    mls_listing_price:    raw.mlsListingPrice      ?? null,
    mls_active:           raw.mlsActive            ?? false,
    mls_number:           raw.mlsId ?? raw.mlsNumber ?? null,
    mls_dom:              raw.daysOnMarket         ?? null,
    mls_cdom:             raw.cumulativeDaysOnMarket ?? null,
    mls_agent_name:       raw.listingAgentName     ?? null,
    mls_agent_phone:      raw.listingAgentPhone    ?? null,
    mls_agent_email:      raw.listingAgentEmail    ?? null,
    mls_broker_name:      raw.listingBrokerageName ?? null,
    mls_original_price:   raw.originalListingPrice ?? null,
    mls_remarks_public:   raw.publicRemarks ?? raw.listingDescription ?? null,
    mls_showing_instructions: raw.showingInstructions ?? null,
    mls_hoa_amount:       raw.hoaFee ?? raw.associationFee ?? null,
    mls_photos:           extractPhotos(raw),
    mls_price_history:    extractPriceHistory(raw),
  }
}

function extractPhotos(raw: Record<string, unknown>): string[] {
  const photos = raw.photos ?? raw.mlsPhotos ?? raw.images
  if (Array.isArray(photos)) {
    return photos.map(p => typeof p === 'string' ? p : (p as Record<string, string>)?.url ?? (p as Record<string, string>)?.href ?? '').filter(Boolean)
  }
  return []
}

function extractPriceHistory(raw: Record<string, unknown>): { date: string; price: number; event: string }[] {
  const history = raw.priceHistory ?? raw.priceChanges
  if (Array.isArray(history)) return history as { date: string; price: number; event: string }[]
  return []
}

function buildRealtorUrl(address: string, city?: string | null, state?: string | null, zip?: string | null): string {
  // Realtor.com URL format: /realestateandhomes-detail/{street-address}_{city}_{state}_{zip}
  const parts = [address, city, state ?? 'FL', zip].filter(Boolean).join(' ')
  const slug = parts.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `https://www.realtor.com/realestateandhomes-detail/${slug}`
}
