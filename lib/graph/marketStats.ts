/**
 * Market Statistics Engine — Sprint 3
 *
 * Aggregates listing_intelligence rows we already hold into pre-computed
 * market summaries. No additional provider call is required — we use what
 * we already fetched and stored.
 *
 * Design rules:
 *   - Aggregation only — no AI, no external calls, no Redis
 *   - market_key format: 'zip:33101' | 'city:Miami:FL' | 'zip:33101:SFR'
 *   - Months-of-supply is only computed when ≥3 months of closed data exists
 *   - Confidence tiers: high (n≥30), medium (n≥10), low (n<10)
 *   - Cache: market stats valid for 6h — checked before recomputing
 *   - UNIQUE(market_key, period_start, period_type) — safe to recompute
 *   - Position summary is computed at read-time (not stored) to avoid staleness
 *
 * Calculation version: bump CALC_VERSION when any formula changes.
 */

import { serviceClient }  from '@/lib/supabase-service'
import type { MarketStatistics, MarketContext, ListingIntelligence } from './types'

export const CALC_VERSION = 'v1.0'

// ── Cache TTL ─────────────────────────────────────────────────────────────────

const MARKET_STATS_TTL_H = 6   // recompute every 6h

// ── Market key helpers ────────────────────────────────────────────────────────

export function buildMarketKey(zip: string | null, city?: string | null, state?: string | null, propertyType?: string | null): string {
  if (zip) {
    const base = `zip:${zip}`
    return propertyType ? `${base}:${propertyType}` : base
  }
  if (city && state) return `city:${city}:${state}`
  return 'unknown'
}

// ── Statistical helpers ───────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

function confidenceTier(n: number): 'high' | 'medium' | 'low' {
  if (n >= 30) return 'high'
  if (n >= 10) return 'medium'
  return 'low'
}

// ── Load listing data for a market key ───────────────────────────────────────

interface MarketListingRow {
  status: string | null
  list_price: number | null
  close_price: number | null
  days_on_market: number | null
  price_reduction_count: number | null
  price_per_sqft: number | null
  close_date: string | null
  fetched_at: string
}

async function loadListingsForMarket(
  zip: string | null,
  city: string | null,
  periodDays: number,
): Promise<MarketListingRow[]> {
  // Fetch from listing_intelligence via properties join (we need zip/city)
  const since = new Date(Date.now() - periodDays * 24 * 3600000).toISOString()

  // Join listing_intelligence → properties to filter by geography
  const { data } = await serviceClient
    .from('listing_intelligence')
    .select(`
      status,
      list_price,
      close_price,
      days_on_market,
      price_reduction_count,
      price_per_sqft,
      close_date,
      fetched_at,
      properties!inner(zip, city)
    `)
    .gte('fetched_at', since)

  if (!data) return []

  // Filter by geography in JS (Supabase join filtering on embedded table)
  return (data as unknown as (MarketListingRow & { properties: { zip: string | null; city: string | null } })[])
    .filter(row => {
      if (zip) return row.properties?.zip === zip
      if (city) return (row.properties?.city ?? '').toLowerCase() === city.toLowerCase()
      return false
    })
}

// ── Core aggregation ──────────────────────────────────────────────────────────

interface AggregationResult {
  activeListings: number
  pendingCount: number
  soldCount: number
  medianListPrice: number | null
  medianClosePrice: number | null
  medianPriceSqft: number | null
  medianDom: number | null
  medianSpLpRatio: number | null
  priceReductionRate: number | null
  totalVolume: number | null
  monthsOfSupply: number | null
  absorptionMonths: number | null
  sampleSize: number
}

function aggregate(rows: MarketListingRow[], periodDays: number): AggregationResult {
  const active  = rows.filter(r => r.status === 'Active')
  const pending = rows.filter(r => r.status === 'Pending')
  const sold    = rows.filter(r => r.status === 'Closed')

  const activePrices  = active.map(r => r.list_price).filter((p): p is number => p != null)
  const soldPrices    = sold.map(r => r.close_price).filter((p): p is number => p != null)
  const ppsqftAll     = rows.map(r => r.price_per_sqft).filter((p): p is number => p != null)
  const domAll        = rows.map(r => r.days_on_market).filter((d): d is number => d != null)
  const soldListPairs = sold.filter(r => r.list_price && r.close_price)
  const spLpRatios    = soldListPairs.map(r => (r.close_price ?? 0) / (r.list_price ?? 1))

  const withReductions = rows.filter(r => r.status === 'Active' || r.status === 'Pending')
  const priceReductionRate = withReductions.length > 0
    ? withReductions.filter(r => (r.price_reduction_count ?? 0) >= 1).length / withReductions.length
    : null

  const totalVolume = soldPrices.reduce((s, p) => s + p, 0) || null

  // Months of supply: only compute when we have ≥3 months of sold data
  // Formula: active_listings / (sold_per_month)
  // sold_per_month = soldCount / (periodDays / 30)
  let monthsOfSupply: number | null = null
  let absorptionMonths: number | null = null
  if (periodDays >= 90 && sold.length >= 3 && active.length > 0) {
    const soldPerMonth = sold.length / (periodDays / 30)
    if (soldPerMonth > 0) {
      monthsOfSupply   = parseFloat((active.length / soldPerMonth).toFixed(1))
      absorptionMonths = parseFloat((1 / soldPerMonth).toFixed(2))
    }
  }

  return {
    activeListings:     active.length,
    pendingCount:       pending.length,
    soldCount:          sold.length,
    medianListPrice:    median(activePrices),
    medianClosePrice:   median(soldPrices),
    medianPriceSqft:    median(ppsqftAll),
    medianDom:          median(domAll),
    medianSpLpRatio:    median(spLpRatios),
    priceReductionRate,
    totalVolume,
    monthsOfSupply,
    absorptionMonths,
    sampleSize:         rows.length,
  }
}

// ── Load cached stats ─────────────────────────────────────────────────────────

async function loadCachedStats(marketKey: string): Promise<MarketStatistics | null> {
  const { data } = await serviceClient
    .from('market_statistics')
    .select('*')
    .eq('market_key', marketKey)
    .eq('period_type', 'monthly')
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  // Check if within TTL
  const age = Date.now() - new Date(data.computed_at as string).getTime()
  if (age > MARKET_STATS_TTL_H * 3600000) return null

  return rowToMarketStatistics(data as Record<string, unknown>)
}

// ── Persist stats ─────────────────────────────────────────────────────────────

async function persistStats(
  marketKey: string,
  agg:       AggregationResult,
  periodDays: number,
): Promise<MarketStatistics | null> {
  const now        = new Date()
  const periodEnd  = now.toISOString().substring(0, 10)
  const periodStart = new Date(Date.now() - periodDays * 86400000).toISOString().substring(0, 10)

  const row = {
    market_key:          marketKey,
    period_start:        periodStart,
    period_end:          periodEnd,
    period_type:         'monthly',
    active_listings:     agg.activeListings,
    pending_count:       agg.pendingCount,
    sold_count:          agg.soldCount,
    closed_listings:     agg.soldCount,
    median_list_price:   agg.medianListPrice,
    median_close_price:  agg.medianClosePrice,
    median_price_sqft:   agg.medianPriceSqft,
    median_dom:          agg.medianDom,
    median_sp_lp_ratio:  agg.medianSpLpRatio,
    absorption_months:   agg.absorptionMonths,
    months_of_supply:    agg.monthsOfSupply,
    price_reduction_rate: agg.priceReductionRate,
    total_volume:        agg.totalVolume,
    sample_size:         agg.sampleSize,
    confidence:          confidenceTier(agg.sampleSize),
    calculation_version: CALC_VERSION,
    source:              'computed',
    computed_at:         now.toISOString(),
  }

  const { data, error } = await serviceClient
    .from('market_statistics')
    .upsert(row, { onConflict: 'market_key,period_start,period_type' })
    .select('*')
    .single()

  if (error) {
    console.error(`[MarketStats] persist failed for ${marketKey}:`, error.message)
    return null
  }

  return rowToMarketStatistics(data as Record<string, unknown>)
}

// ── Row → MarketStatistics ────────────────────────────────────────────────────

function rowToMarketStatistics(row: Record<string, unknown>): MarketStatistics {
  return {
    id:                  row.id as string,
    marketKey:           row.market_key as string,
    periodStart:         row.period_start as string,
    periodEnd:           row.period_end as string,
    periodType:          (row.period_type as 'monthly' | 'quarterly' | 'annual') ?? 'monthly',
    activeListings:      (row.active_listings as number | null) ?? null,
    pendingCount:        (row.pending_count as number | null) ?? null,
    soldCount:           (row.sold_count as number | null) ?? null,
    newListings:         (row.new_listings as number | null) ?? null,
    closedListings:      (row.closed_listings as number | null) ?? null,
    expiredListings:     (row.expired_listings as number | null) ?? null,
    medianListPrice:     (row.median_list_price as number | null) ?? null,
    medianClosePrice:    (row.median_close_price as number | null) ?? null,
    medianPriceSqft:     (row.median_price_sqft as number | null) ?? null,
    medianSpLpRatio:     (row.median_sp_lp_ratio as number | null) ?? null,
    medianDom:           (row.median_dom as number | null) ?? null,
    absorptionMonths:    (row.absorption_months as number | null) ?? null,
    monthsOfSupply:      (row.months_of_supply as number | null) ?? null,
    priceReductionRate:  (row.price_reduction_rate as number | null) ?? null,
    totalVolume:         (row.total_volume as number | null) ?? null,
    sampleSize:          (row.sample_size as number | null) ?? null,
    confidence:          (row.confidence as 'high' | 'medium' | 'low' | null) ?? null,
    calculationVersion:  (row.calculation_version as string) ?? CALC_VERSION,
    source:              (row.source as string) ?? 'computed',
    computedAt:          row.computed_at as string,
    createdAt:           row.created_at as string,
  }
}

// ── Position summary ──────────────────────────────────────────────────────────

function buildPositionSummary(
  listing: ListingIntelligence | null,
  stats:   MarketStatistics | null,
): MarketContext['positionSummary'] {
  if (!listing || !stats) return null

  const medianPrice = stats.medianListPrice
  const listPrice   = listing.listPrice
  const pricingPosition: 'below_market' | 'at_market' | 'above_market' | null =
    listPrice == null || medianPrice == null ? null
    : listPrice < medianPrice * 0.95  ? 'below_market'
    : listPrice > medianPrice * 1.05  ? 'above_market'
    : 'at_market'

  const medianDom = stats.medianDom
  const dom       = listing.daysOnMarket
  const domPosition: 'fast' | 'normal' | 'slow' | null =
    dom == null || medianDom == null ? null
    : dom < medianDom * 0.7  ? 'fast'
    : dom > medianDom * 1.3  ? 'slow'
    : 'normal'

  return {
    pricingPosition,
    domPosition,
    lowConfidence: stats.confidence === 'low' || stats.sampleSize == null || stats.sampleSize < 10,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GetMarketContextOptions {
  force?:      boolean
  periodDays?: number
}

/**
 * Get market context for a property — computed from listing_intelligence rows
 * we already hold for the same ZIP code.
 *
 * No external API call: uses our own data. Cost = $0.
 *
 * @param propertyId    - The subject property
 * @param listing       - The subject's listing intelligence (for position summary)
 * @param zip           - ZIP code (for market_key)
 * @param city          - City (fallback if no ZIP)
 * @param state         - State (used with city)
 * @param opts          - Override defaults
 */
export async function getMarketContext(
  propertyId: string,
  listing:    ListingIntelligence | null,
  zip:        string | null,
  city:       string | null,
  state:      string | null,
  opts:       GetMarketContextOptions = {},
): Promise<MarketContext> {
  const fetchedAt  = new Date().toISOString()
  const marketKey  = buildMarketKey(zip, city, state)
  const periodDays = opts.periodDays ?? 90

  // ── 1. Cache check ────────────────────────────────────────────────────────
  if (!opts.force) {
    const cached = await loadCachedStats(marketKey)
    if (cached) {
      return {
        propertyId,
        marketKey,
        statistics:      cached,
        positionSummary: buildPositionSummary(listing, cached),
        fetchedAt,
        fromCache: true,
      }
    }
  }

  // ── 2. Load listing rows for this market ──────────────────────────────────
  const rows = await loadListingsForMarket(zip, city, periodDays)

  if (!rows.length) {
    return {
      propertyId,
      marketKey,
      statistics:      null,
      positionSummary: null,
      fetchedAt,
      fromCache: false,
    }
  }

  // ── 3. Aggregate ──────────────────────────────────────────────────────────
  const agg = aggregate(rows, periodDays)

  // ── 4. Persist ────────────────────────────────────────────────────────────
  const stats = await persistStats(marketKey, agg, periodDays)

  return {
    propertyId,
    marketKey,
    statistics:      stats,
    positionSummary: buildPositionSummary(listing, stats),
    fetchedAt,
    fromCache: false,
  }
}
