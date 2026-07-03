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
