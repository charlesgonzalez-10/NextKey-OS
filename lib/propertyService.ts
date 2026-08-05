/**
 * Property Intelligence Service — central data layer for NextKey OS.
 *
 * Every external API call (REAPI, Rentcast, PA) must flow through this service.
 * It enforces the four-tier refresh model, builds historical snapshots, tracks
 * search history, and accumulates market intelligence — all without touching
 * the existing CRM tables or workflows.
 *
 * Architecture:
 *   API Route → propertyService → property_freshness (check)
 *                               → external API (only if stale)
 *                               → property_snapshots (before overwrite)
 *                               → properties (update)
 *                               → property_freshness (mark refreshed)
 *                               → market_intelligence_events (fire-and-forget)
 */

import { serviceClient } from './supabase-service'
import { REFRESH_TIERS, type ModuleName } from './refreshTiers'
import type { PropertySearchResult } from './enrichment/types'
import { resolveDsoe } from './graph/dsoeRouter'
import type {
  ListingIntelligence,
  UpsertOpportunitySignalInput,
  VelocitySignals,
  ScoreBreakdown,
  OpportunitySignal,
} from './graph/types'
import { processPriceHistory }  from './graph/priceHistory'
import { processListingCycle }  from './graph/listingCycle'
import { deriveMlsSignalsFromListing, attachPropertyId } from './graph/signals'
import { computeScores }        from './graph/scoring'
import { getComparableIntelligence as fetchComparables, type GetCompsOptions } from './graph/comparables'
import { getMarketContext as fetchMarketContext, type GetMarketContextOptions } from './graph/marketStats'
import type { ComparableIntelligence, MarketContext, PropertySummary } from './graph/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FreshnessResult {
  isFresh:       boolean
  lastRefreshed: Date | null
  daysSince:     number | null
  source:        string | null
  ttlDays:       number
}

export interface ModuleFreshnessMap {
  [module: string]: FreshnessResult
}

// ─── Freshness checking ───────────────────────────────────────────────────────

/**
 * Check whether a module's data is still within its TTL.
 * Returns isFresh=true for L1 (static) and L4 (internal) — these are never
 * fetched from external APIs by the service.
 */
export async function getModuleFreshness(
  propertyId: string,
  module: ModuleName,
  opts: { isActiveListing?: boolean; force?: boolean } = {}
): Promise<FreshnessResult> {
  const tier = REFRESH_TIERS[module]

  // L1 (static) and L4 (internal): always report fresh
  if (tier.level === 1 || tier.level === 4) {
    return { isFresh: true, lastRefreshed: null, daysSince: null, source: null, ttlDays: tier.ttlDays }
  }

  if (opts.force) {
    return { isFresh: false, lastRefreshed: null, daysSince: null, source: null, ttlDays: 0 }
  }

  const { data } = await serviceClient
    .from('property_freshness')
    .select('refreshed_at, source')
    .eq('property_id', propertyId)
    .eq('module', module)
    .maybeSingle()

  if (!data) {
    return { isFresh: false, lastRefreshed: null, daysSince: null, source: null, ttlDays: tier.ttlDays }
  }

  const lastRefreshed  = new Date(data.refreshed_at)
  const daysSince      = (Date.now() - lastRefreshed.getTime()) / 86_400_000
  const effectiveTtl   = (opts.isActiveListing && tier.activeTtlDays != null)
    ? tier.activeTtlDays
    : tier.ttlDays

  return {
    isFresh: daysSince <= effectiveTtl,
    lastRefreshed,
    daysSince,
    source:  data.source,
    ttlDays: effectiveTtl,
  }
}

/**
 * Convenience wrapper — returns true when the module needs an external refresh.
 */
export async function shouldRefreshModule(
  propertyId: string,
  module: ModuleName,
  opts: { isActiveListing?: boolean; force?: boolean } = {}
): Promise<boolean> {
  const result = await getModuleFreshness(propertyId, module, opts)
  return !result.isFresh
}

/**
 * Returns freshness status for every module in a single DB round-trip.
 * Used by the workspace loader to surface "stale" indicators in the UI.
 */
export async function getAllModuleFreshness(propertyId: string): Promise<ModuleFreshnessMap> {
  const { data } = await serviceClient
    .from('property_freshness')
    .select('module, refreshed_at, source')
    .eq('property_id', propertyId)

  const rows = data ?? []
  const map: ModuleFreshnessMap = {}

  for (const [mod, tier] of Object.entries(REFRESH_TIERS) as [ModuleName, typeof REFRESH_TIERS[ModuleName]][]) {
    if (tier.level === 1 || tier.level === 4) {
      map[mod] = { isFresh: true, lastRefreshed: null, daysSince: null, source: null, ttlDays: tier.ttlDays }
      continue
    }
    const row = rows.find(r => r.module === mod)
    if (!row) {
      map[mod] = { isFresh: false, lastRefreshed: null, daysSince: null, source: null, ttlDays: tier.ttlDays }
    } else {
      const lastRefreshed = new Date(row.refreshed_at)
      const daysSince     = (Date.now() - lastRefreshed.getTime()) / 86_400_000
      map[mod] = {
        isFresh: daysSince <= tier.ttlDays,
        lastRefreshed,
        daysSince,
        source: row.source,
        ttlDays: tier.ttlDays,
      }
    }
  }

  return map
}

// ─── Mark refreshed ───────────────────────────────────────────────────────────

/**
 * Record a successful external fetch in property_freshness.
 * Call this immediately AFTER writing fresh data to the properties table.
 */
export async function markModuleRefreshed(
  propertyId: string,
  module: ModuleName,
  source: string
): Promise<void> {
  const tier = REFRESH_TIERS[module]
  await serviceClient
    .from('property_freshness')
    .upsert(
      {
        property_id:  propertyId,
        module,
        source,
        refreshed_at: new Date().toISOString(),
        ttl_days:     isFinite(tier.ttlDays) ? tier.ttlDays : null,
      },
      { onConflict: 'property_id,module' }
    )
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

/**
 * Write raw key/value pairs to property_snapshots.
 * Call this BEFORE overwriting a property's fields.
 */
export async function snapshotValues(
  propertyId: string,
  values: Record<string, unknown>,
  source: string
): Promise<void> {
  const rows = Object.entries(values)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([key, value]) => ({
      property_id:   propertyId,
      snapshot_key:  key,
      value_numeric: typeof value === 'number' ? value : null,
      value_text:    typeof value === 'string' ? value : null,
      value_json:    typeof value === 'object' && value !== null ? value : null,
      source,
      captured_at:   new Date().toISOString(),
    }))

  if (rows.length) {
    await serviceClient.from('property_snapshots').insert(rows)
  }
}

/**
 * Read the current DB values for a module's snapshot keys, then write them
 * to property_snapshots. Call this BEFORE overwriting those fields.
 */
export async function snapshotBeforeUpdate(
  propertyId: string,
  module: ModuleName,
  source: string
): Promise<void> {
  const tier = REFRESH_TIERS[module]
  if (!tier.snapshotKeys.length) return

  const { data } = await serviceClient
    .from('properties')
    .select(tier.snapshotKeys.join(', '))
    .eq('id', propertyId)
    .single()

  if (data) {
    await snapshotValues(propertyId, data as unknown as Record<string, unknown>, source)
  }
}

// ─── Search history ───────────────────────────────────────────────────────────

/**
 * Record a property search event. Atomically increments the counter.
 * Fire-and-forget — never throws, never blocks the response.
 *
 * The resulting search_frequency (low / medium / high) is read by the
 * daily refresh cron (app/api/cron/refresh-saved) to prioritize stale
 * properties that are actively being worked in the workspace — ensuring
 * high-frequency properties are refreshed first when the cron has a batch limit.
 */
export function recordPropertySearch(propertyId: string): void {
  void serviceClient
    .rpc('record_property_search', { p_property_id: propertyId })
    .then(() => {}, () => {})
}

// ─── Ensure intelligence record ───────────────────────────────────────────────

/**
 * Ensure a searched property exists in the properties table as an intelligence
 * record. If already present (matched by folio), returns the existing id.
 * If not found, inserts a new record from the search result data.
 *
 * This is how "every searched property becomes an intelligence record" without
 * creating a Lead or any CRM record.
 *
 * Returns the property id (existing or newly created), or null on failure.
 */
export async function ensurePropertyRecord(
  result: PropertySearchResult
): Promise<string | null> {
  // Property is already in DB — distress overlay included its id
  if (result.distress?.lead_id) return result.distress.lead_id

  // No folio = too risky to insert (can't deduplicate reliably)
  if (!result.folio) return null

  // Build the record — only include non-null values
  const record: Record<string, unknown> = {}
  const set = (k: string, v: unknown) => { if (v != null) record[k] = v }

  set('folio_number',      result.folio)
  set('property_address',  result.property_address)
  set('city',              result.city)
  set('state',             result.state)
  set('zip',               result.zip)
  set('county',            result.county)
  set('data_source',       result.source)
  // Building
  set('beds',              result.beds)
  set('baths',             result.baths)
  set('living_area',       result.living_area)
  set('lot_size',          result.lot_size)
  set('year_built',        result.year_built)
  set('property_type',     result.property_use)
  set('legal_description', result.legal_desc)
  set('zoning',            result.zoning)
  set('subdivision_name',  result.subdivision)
  // Ownership
  set('owner_name',       result.owner_name)
  set('mailing_address',  result.mailing_address)
  set('owner_state',      result.owner_state)
  set('owner_zip',        result.owner_zip)
  // Valuation
  set('market_value',     result.market_value)
  set('assessed_value',   result.assessed_value)
  set('land_value',       result.land_value)
  set('building_value',   result.building_value)
  set('tax_amount',       result.annual_taxes)
  set('tax_year',         result.tax_year)
  // Sale history
  set('last_sale_date',   result.last_sale_date)
  set('sold_price',       result.last_sale_amount)
  // Enrichment metadata
  record.enriched_at    = new Date().toISOString()
  record.enrichment_src = result.source

  const { data, error } = await serviceClient
    .from('properties')
    .upsert(record, { onConflict: 'folio_number', ignoreDuplicates: false })
    .select('id')
    .single()

  if (error) {
    console.error('[PropertyService] ensurePropertyRecord failed:', error.message)
    return null
  }

  // Mark which modules were refreshed as part of this upsert
  if (data?.id) {
    const id = data.id as string
    Promise.all([
      markModuleRefreshed(id, 'ownership', result.source),
      markModuleRefreshed(id, 'valuation', result.source),
      markModuleRefreshed(id, 'details',   result.source),
    ]).then(() => {}, () => {})
  }

  return (data?.id as string) ?? null
}

// ─── Market intelligence ──────────────────────────────────────────────────────

/**
 * Quietly accumulate market data points from a refreshed property.
 * Fire-and-forget — never blocks the main request path.
 */
export function accumulateMarketData(
  opts: {
    zip?:              string | null
    city?:             string | null
    county?:           string | null
    market_value?:     number | null
    rent_estimate?:    number | null
    mls_dom?:          number | null
    mls_listing_price?: number | null
    mls_price_reductions?: number | null
    source?:           string
    propertyId?:       string
  }
): void {
  const events: {
    geography_type:  string
    geography_value: string
    stat_type:       string
    value_numeric:   number
    property_id?:    string
    source?:         string
    recorded_at:     string
  }[] = []

  const now = new Date().toISOString()

  const geos: [string, string | null | undefined][] = [
    ['zip',    opts.zip],
    ['city',   opts.city],
    ['county', opts.county],
  ]

  for (const [geoType, geoVal] of geos) {
    if (!geoVal) continue
    const push = (stat: string, val: number | null | undefined) => {
      if (val == null) return
      events.push({
        geography_type:  geoType,
        geography_value: geoVal,
        stat_type:       stat,
        value_numeric:   val,
        property_id:     opts.propertyId,
        source:          opts.source ?? 'property-service',
        recorded_at:     now,
      })
    }
    push('market_value',   opts.market_value)
    push('rent_estimate',  opts.rent_estimate)
    push('dom',            opts.mls_dom)
    push('list_price',     opts.mls_listing_price)
    push('price_reductions', opts.mls_price_reductions)
  }

  if (!events.length) return

  void serviceClient
    .from('market_intelligence_events')
    .insert(events)
    .then(() => {}, (err) => console.error('[MarketData] insert failed:', err))
}

// ─── Phase 6.5 Sprint 2: Listing Intelligence (canonical MLS store) ───────────
// listing_intelligence is the single source of truth for MLS data.
// properties.mls_* columns are a backward-compat projection kept in sync by
// syncLegacyMlsColumns() after every listing_intelligence write.

const LISTING_TTL_ACTIVE_MS   = 2  * 60 * 60 * 1000  // 2h  — active listings refresh often
const LISTING_TTL_INACTIVE_MS = 24 * 60 * 60 * 1000  // 24h — closed/pending check daily

/**
 * Return listing intelligence for a property.
 *
 * Cache hit: returns from listing_intelligence if within TTL.
 * Cache miss: fetches from REAPI via DSOE router, then:
 *   1. Processes price history (writes listing_price_history)
 *   2. Manages listing cycle (writes listing_history + listing_events)
 *   3. Derives deterministic signals (writes opportunity_signals)
 *   4. Computes Market Position + Acquisition Opportunity scores
 *   5. Upserts listing_intelligence (canonical store)
 *   6. Syncs properties.mls_* (backward-compat projection, fire-and-forget)
 *
 * PropertyGraphService delegates here — it never calls the DSOE router directly.
 */
export async function getListingIntelligence(
  propertyId: string,
  opts: { force?: boolean } = {},
): Promise<ListingIntelligence | null> {
  // ── 1. Cache check ──────────────────────────────────────────────────────────
  let previousRow: Record<string, unknown> | null = null

  const { data: existing } = await serviceClient
    .from('listing_intelligence')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle()

  if (existing && !opts.force) {
    const fetchedAt = new Date(existing.fetched_at as string).getTime()
    const isActive  = existing.status === 'Active'
    const ttl       = isActive ? LISTING_TTL_ACTIVE_MS : LISTING_TTL_INACTIVE_MS
    if (Date.now() - fetchedAt < ttl) {
      return rowToListingIntelligence(existing)
    }
  }
  // Keep previous row for cycle + price history comparison even on cache miss
  previousRow = existing ?? null

  // ── 2. Resolve property identifiers ─────────────────────────────────────────
  const { data: prop } = await serviceClient
    .from('properties')
    .select('folio_number, property_address, city, county, latitude, longitude')
    .eq('id', propertyId)
    .single()

  if (!prop) return null

  // ── 3. Fetch from REAPI via DSOE router ─────────────────────────────────────
  const dsoeResult = await resolveDsoe({
    propertyId,
    intent:  'listing',
    folio:   (prop.folio_number as string | null) ?? null,
    address: (prop.property_address as string | null) ?? null,
    city:    (prop.city as string | null) ?? null,
    county:  (prop.county as string | null) ?? null,
    lat:     (prop.latitude as number | null) ?? null,
    lng:     (prop.longitude as number | null) ?? null,
  })

  if (!dsoeResult.listing) return null
  const listing = dsoeResult.listing

  const prevIntelligence = previousRow ? rowToListingIntelligence(previousRow) : null

  // ── 4. Price history processing ──────────────────────────────────────────────
  const priceResult = await processPriceHistory(
    propertyId, prevIntelligence, listing, listing.source,
  )

  // ── 5. Listing cycle management ──────────────────────────────────────────────
  const cycleResult = await processListingCycle(
    propertyId, prevIntelligence, listing, listing.source,
  )

  // ── 6. Build velocity signals ────────────────────────────────────────────────
  const domTrend: VelocitySignals['domTrend'] =
    (listing.daysOnMarket ?? 0) > 45 ? 'stalling'
    : (listing.daysOnMarket ?? 0) <= 14 ? 'accelerating'
    : 'normal'

  const velocitySignals: VelocitySignals = {
    priceReductionCount: listing.priceReductionCount,
    totalReductionPct:   priceResult.totalReductionPct,
    backOnMarket:        cycleResult.backOnMarket,
    domTrend,
    listingCycle:        cycleResult.listingCycle,
  }

  // ── 7. Fetch current signals for scoring (from DB) ───────────────────────────
  const { data: signalRows } = await serviceClient
    .from('opportunity_signals')
    .select('*')
    .eq('property_id', propertyId)
    .eq('is_active', true)

  const activeSignals = (signalRows ?? []).map(s => ({
    id:           s.id as string,
    propertyId:   s.property_id as string,
    signalType:   s.signal_type as OpportunitySignal['signalType'],
    signalSource: s.signal_source as string,
    isActive:     s.is_active as boolean,
    confidence:   s.confidence as number,
    signalData:   (s.signal_data as Record<string, unknown>) ?? {},
    detectedAt:   s.detected_at as string,
    expiresAt:    (s.expires_at as string | null) ?? null,
    createdAt:    s.created_at as string,
    updatedAt:    s.updated_at as string,
  })) as import('./graph/types').OpportunitySignal[]

  // ── 8. Score computation ────────────────────────────────────────────────────
  const scores = computeScores(
    {
      daysOnMarket:        listing.daysOnMarket,
      priceReductionCount: listing.priceReductionCount,
      status:              listing.status === 'Unknown' ? null : listing.status,
      backOnMarket:        cycleResult.backOnMarket,
      listingCycle:        cycleResult.listingCycle,
    },
    {
      daysOnMarket:        listing.daysOnMarket,
      priceReductionCount: listing.priceReductionCount,
      status:              listing.status === 'Unknown' ? null : listing.status,
      activeSignals,
    },
  )

  // ── 9. Upsert listing_intelligence (canonical store) ─────────────────────────
  const now = new Date().toISOString()
  const row = {
    property_id:                   propertyId,
    mls_number:                    listing.mlsNumber,
    source:                        listing.source,
    list_price:                    listing.listPrice,
    close_price:                   listing.closePrice,
    original_list_price:           listing.originalListPrice,
    list_date:                     listing.listDate,
    close_date:                    listing.closeDate,
    status:                        listing.status === 'Unknown' ? null : listing.status,
    days_on_market:                listing.daysOnMarket,
    cumulative_dom:                listing.cumulativeDom,
    price_per_sqft:                listing.pricePerSqFt,
    price_reduction_count:         listing.priceReductionCount,
    hoa_amount:                    listing.hoaAmount,
    listing_cycle:                 cycleResult.listingCycle,
    market_position_score:         scores.marketPositionScore,
    acquisition_opportunity_score: scores.acquisitionOpportunityScore,
    scoring_breakdown:             scores.scoringBreakdown,
    velocity_signals:              velocitySignals,
    pricing_intelligence:          {},
    list_agent_name:               listing.agent.listAgentName,
    list_agent_phone:              listing.agent.listAgentPhone,
    list_agent_email:              listing.agent.listAgentEmail,
    list_office_name:              listing.agent.listOfficeName,
    remarks:                       listing.remarks,
    photo_count:                   listing.photos.length,
    display_allowed:               false,
    raw_source:                    listing.rawSource,
    fetched_at:                    now,
  }

  const { data: upserted, error: upsertErr } = await serviceClient
    .from('listing_intelligence')
    .upsert(row, { onConflict: 'property_id' })
    .select('*')
    .single()

  if (upsertErr) {
    console.error('[PropertyService] listing_intelligence upsert failed:', upsertErr.message)
    return null
  }

  // ── 10. Derive and persist MLS signals (fire-and-forget) ─────────────────────
  const mlsSignals = attachPropertyId(
    deriveMlsSignalsFromListing(listing, {
      isBackOnMarket: cycleResult.backOnMarket,
      existingHoaAmount: listing.hoaAmount,
    }),
    propertyId,
  )
  void Promise.all(mlsSignals.map(s => recordOpportunitySignal(s))).catch(() => {})

  // ── 11. Sync backward-compat mls_* projection (fire-and-forget) ───────────────
  void syncLegacyMlsColumns(propertyId, upserted as Record<string, unknown>).catch(() => {})

  return rowToListingIntelligence(upserted)
}

// ── Map DB row → ListingIntelligence ─────────────────────────────────────────

function rowToListingIntelligence(row: Record<string, unknown>): ListingIntelligence {
  return {
    id:                          row.id as string,
    propertyId:                  row.property_id as string,
    mlsNumber:                   (row.mls_number as string | null) ?? null,
    source:                      (row.source as ListingIntelligence['source']) ?? 'reapi',
    listPrice:                   (row.list_price as number | null) ?? null,
    closePrice:                  (row.close_price as number | null) ?? null,
    originalListPrice:           (row.original_list_price as number | null) ?? null,
    listDate:                    (row.list_date as string | null) ?? null,
    closeDate:                   (row.close_date as string | null) ?? null,
    status:                      (row.status as ListingIntelligence['status']) ?? null,
    daysOnMarket:                (row.days_on_market as number | null) ?? null,
    cumulativeDom:               (row.cumulative_dom as number | null) ?? null,
    pricePerSqFt:                (row.price_per_sqft as number | null) ?? null,
    priceReductionCount:         (row.price_reduction_count as number | null) ?? null,
    hoaAmount:                   (row.hoa_amount as number | null) ?? null,
    listingCycle:                (row.listing_cycle as number) ?? 1,
    marketPositionScore:         (row.market_position_score as number | null) ?? null,
    acquisitionOpportunityScore: (row.acquisition_opportunity_score as number | null) ?? null,
    scoringBreakdown:            (row.scoring_breakdown as ScoreBreakdown | null) ?? null,
    velocitySignals:             (row.velocity_signals as VelocitySignals) ?? {},
    pricingIntelligence:         (row.pricing_intelligence as ListingIntelligence['pricingIntelligence']) ?? {},
    listAgentName:               (row.list_agent_name as string | null) ?? null,
    listAgentPhone:              (row.list_agent_phone as string | null) ?? null,
    listAgentEmail:              (row.list_agent_email as string | null) ?? null,
    listOfficeName:              (row.list_office_name as string | null) ?? null,
    remarks:                     (row.remarks as string | null) ?? null,
    photoCount:                  (row.photo_count as number) ?? 0,
    displayAllowed:              (row.display_allowed as boolean) ?? false,
    fetchedAt:                   row.fetched_at as string,
    createdAt:                   row.created_at as string,
    updatedAt:                   row.updated_at as string,
  }
}

// ── One-way sync: listing_intelligence → properties.mls_* ─────────────────────
// Called fire-and-forget after every listing_intelligence write.
// Keeps the legacy columns as a read-compatible projection.
// mls_sync_at is set ONLY on success so stale rows are detectable.

async function syncLegacyMlsColumns(
  propertyId: string,
  liRow: Record<string, unknown>,
): Promise<void> {
  const { error } = await serviceClient
    .from('properties')
    .update({
      mls_status:           liRow.status ?? null,
      mls_listing_price:    liRow.list_price ?? null,
      mls_active:           liRow.status === 'Active',
      mls_number:           liRow.mls_number ?? null,
      mls_dom:              liRow.days_on_market ?? null,
      mls_cdom:             liRow.cumulative_dom ?? null,
      mls_price_reductions: liRow.price_reduction_count ?? null,
      mls_original_price:   liRow.original_list_price ?? null,
      mls_agent_name:       liRow.list_agent_name ?? null,
      mls_agent_phone:      liRow.list_agent_phone ?? null,
      mls_agent_email:      liRow.list_agent_email ?? null,
      mls_broker_name:      liRow.list_office_name ?? null,
      mls_remarks_public:   liRow.remarks ?? null,
      mls_hoa_amount:       liRow.hoa_amount ?? null,
      mls_sync_at:          new Date().toISOString(), // atomic with other fields; not set on error
    })
    .eq('id', propertyId)

  if (error) {
    // mls_sync_at stays at the old value — detectable by repairStaleMlsProjections()
    console.error(`[PropertyService] syncLegacyMlsColumns failed for property ${propertyId}:`, error.message)
  }
}

/**
 * Repair stale mls_* projections.
 *
 * Finds properties where listing_intelligence exists but properties.mls_sync_at
 * is null or older than the listing_intelligence row's updated_at, then re-runs
 * the sync for each. Safe to call repeatedly — each sync is idempotent.
 *
 * Intended for: scheduled jobs, post-incident repair, CI smoke tests.
 * Does NOT block any write path — runs independently.
 *
 * @param limit - max properties to repair per call (default 50)
 */
export async function repairStaleMlsProjections(limit = 50): Promise<{
  inspected: number
  repaired: number
  errors: number
}> {
  const { data: stale } = await serviceClient
    .from('listing_intelligence')
    .select('property_id, status, list_price, mls_number, days_on_market, cumulative_dom, price_reduction_count, original_list_price, list_agent_name, list_agent_phone, list_agent_email, list_office_name, remarks, hoa_amount, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit * 3) // over-fetch since we'll filter below

  if (!stale?.length) return { inspected: 0, repaired: 0, errors: 0 }

  // Get mls_sync_at for all candidate properties
  const propertyIds = stale.map(r => r.property_id as string)
  const { data: props } = await serviceClient
    .from('properties')
    .select('id, mls_sync_at')
    .in('id', propertyIds)

  const syncAtMap = new Map((props ?? []).map(p => [p.id as string, p.mls_sync_at as string | null]))

  const toRepair = stale.filter(li => {
    const syncAt = syncAtMap.get(li.property_id as string) ?? null
    if (!syncAt) return true
    return new Date(li.updated_at as string) > new Date(syncAt)
  }).slice(0, limit)

  let repaired = 0
  let errors   = 0
  for (const li of toRepair) {
    try {
      await syncLegacyMlsColumns(li.property_id as string, li as Record<string, unknown>)
      repaired++
    } catch {
      errors++
    }
  }

  return { inspected: toRepair.length, repaired, errors }
}

/**
 * Mismatch detection — compares listing_intelligence values against properties.mls_*
 * Returns a list of fields where the values diverge.
 *
 * Use this in tests or diagnostics. A non-empty array means the one-way sync
 * has not run or failed for this property.
 */
export async function detectMlsMismatch(propertyId: string): Promise<{
  field: string
  canonical: unknown
  legacy: unknown
}[]> {
  const [{ data: li }, { data: prop }] = await Promise.all([
    serviceClient.from('listing_intelligence').select('status,list_price,days_on_market,price_reduction_count,mls_number').eq('property_id', propertyId).maybeSingle(),
    serviceClient.from('properties').select('mls_status,mls_listing_price,mls_dom,mls_price_reductions,mls_number').eq('id', propertyId).maybeSingle(),
  ])

  if (!li || !prop) return []

  const checks: [string, unknown, unknown][] = [
    ['mls_status',           li.status,                prop.mls_status],
    ['mls_listing_price',    li.list_price,            prop.mls_listing_price],
    ['mls_dom',              li.days_on_market,        prop.mls_dom],
    ['mls_price_reductions', li.price_reduction_count, prop.mls_price_reductions],
    ['mls_number',           li.mls_number,            prop.mls_number],
  ]

  return checks
    .filter(([, canonical, legacy]) => String(canonical) !== String(legacy))
    .map(([field, canonical, legacy]) => ({ field, canonical, legacy }))
}

/**
 * Upsert an opportunity signal for a property.
 * Uses UNIQUE(property_id, signal_type) — safe to call repeatedly.
 *
 * Domain services call this when they detect a signal. Do NOT call it
 * from PropertyGraphService (reads only) — call it from the fetch/refresh path.
 */
export async function recordOpportunitySignal(
  input: UpsertOpportunitySignalInput,
): Promise<void> {
  const { error } = await serviceClient
    .from('opportunity_signals')
    .upsert(
      {
        property_id:   input.propertyId,
        signal_type:   input.signalType,
        signal_source: input.signalSource,
        is_active:     input.isActive  ?? true,
        confidence:    input.confidence ?? 0.8,
        signal_data:   input.signalData ?? {},
        detected_at:   input.detectedAt ?? new Date().toISOString(),
        expires_at:    input.expiresAt  ?? null,
      },
      { onConflict: 'property_id,signal_type' },
    )

  if (error) {
    console.error('[PropertyService] recordOpportunitySignal failed:', error.message)
  }
}

// ─── Phase 6.5 Sprint 3: Comparable Intelligence ──────────────────────────────

/**
 * Return comparable intelligence for a property.
 *
 * Cache: served from property_comparables when fresh (active <24h, sold <7d).
 * Miss:  fetches Active + Pending + Sold from REAPI (~$0.15), scores, deduplicates, persists.
 *
 * PropertyGraphService delegates here — it never calls the comps provider directly.
 */
export async function getComparableIntelligenceForProperty(
  propertyId: string,
  opts: GetCompsOptions = {},
): Promise<ComparableIntelligence | null> {
  const { data: prop } = await serviceClient
    .from('properties')
    .select('property_address, city, state, zip, beds, baths, living_area, year_built, property_type, latitude, longitude')
    .eq('id', propertyId)
    .single()

  if (!prop) return null

  const subject: PropertySummary = {
    id:            propertyId,
    address:       (prop.property_address as string | null) ?? null,
    city:          (prop.city as string | null) ?? null,
    state:         (prop.state as string | null) ?? null,
    zip:           (prop.zip as string | null) ?? null,
    county:        null,
    beds:          (prop.beds as number | null) ?? null,
    baths:         (prop.baths as number | null) ?? null,
    sqft:          (prop.living_area as number | null) ?? null,
    yearBuilt:     (prop.year_built as number | null) ?? null,
    ownerName:     null,
    marketValue:   null,
    assessedValue: null,
    folioNumber:   null,
    lat:           (prop.latitude as number | null) ?? null,
    lng:           (prop.longitude as number | null) ?? null,
    propertyType:  (prop.property_type as string | null) ?? null,
  }

  return fetchComparables(propertyId, subject, opts)
}

// ─── Phase 6.5 Sprint 3: Market Context ───────────────────────────────────────

/**
 * Return market context for a property's ZIP code.
 *
 * Aggregates listing_intelligence rows we already hold — no external API call.
 * Cache: 6h TTL on market_statistics rows.
 *
 * PropertyGraphService delegates here.
 */
export async function getMarketContextForProperty(
  propertyId: string,
  opts: GetMarketContextOptions = {},
): Promise<MarketContext | null> {
  const [{ data: prop }, { data: liRow }] = await Promise.all([
    serviceClient.from('properties').select('zip, city, state').eq('id', propertyId).single(),
    serviceClient.from('listing_intelligence').select('*').eq('property_id', propertyId).maybeSingle(),
  ])

  if (!prop) return null

  // rowToListingIntelligence is defined above in this file — safe to call here
  const listing = liRow ? rowToListingIntelligence(liRow as Record<string, unknown>) : null

  return fetchMarketContext(
    propertyId,
    listing,
    (prop.zip as string | null) ?? null,
    (prop.city as string | null) ?? null,
    (prop.state as string | null) ?? null,
    opts,
  )
}
