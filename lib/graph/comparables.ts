/**
 * Comparable Intelligence Engine — Sprint 3
 *
 * Ingests raw comps from the MLS provider, applies deterministic similarity
 * scoring, deduplicates by provenance ID, and persists to property_comparables.
 *
 * Design rules:
 *   - No AI — all selection is deterministic with versioned formulas
 *   - No photos fetched — cost control
 *   - Deduplication: UNIQUE(subject_property_id, provenance_id) prevents re-ingestion
 *   - Cache: active comps valid 24h, sold comps valid 7d — checked before any fetch
 *   - Caller (propertyService) owns the "should I refresh?" decision
 *   - This module owns writes to property_comparables only
 *   - Market statistics are NOT computed here — see marketStats.ts
 */

import { serviceClient }        from '@/lib/supabase-service'
import { fetchCompsFromReapi }  from './providers/mlsComps'
import { providerGateway }      from '@/lib/billing/providerGateway'
import { BACKGROUND_CONTEXT }   from '@/lib/billing/gatewayContext'
import type { BillingContext }  from '@/lib/billing/gatewayContext'
import type {
  PropertyComparable,
  ComparableIntelligence,
  CompSelectionBreakdown,
  CompStatus,
  PropertySummary,
} from './types'
import type { NormalizedComp, CompFetchQuery } from './providers/mlsComps'

// ── Selection formula ─────────────────────────────────────────────────────────
// Bump SELECTION_VERSION whenever any weight or threshold changes.
// Old rows in property_comparables carry the version they were scored with.

export const SELECTION_VERSION = 'v1.0'

interface SimilarityWeights {
  distance:     number   // max points from distance proximity
  propertyType: number   // bonus for matching property type
  sqft:         number   // max points from sqft variance
  bedsBaths:    number   // max points from bed/bath match
  yearBuilt:    number   // max points from year-built proximity
  recency:      number   // max points from sale recency (sold only)
  status:       number   // bonus for matching requested status category
  subdivision:  number   // bonus for matching subdivision
}

const WEIGHTS: SimilarityWeights = {
  distance:     30,   // biggest factor — location is king in real estate
  propertyType: 15,
  sqft:         20,
  bedsBaths:    15,
  yearBuilt:    10,
  recency:      5,    // applied to sold comps only
  status:       3,
  subdivision:  2,
}

// Max total = 100 (weights sum to 100)

// ── Distance scoring ──────────────────────────────────────────────────────────
// Closer = higher score. Full points at 0 miles; zero points at or beyond 1 mile.

function scoreDistance(distanceMiles: number | null): number {
  if (distanceMiles == null) return WEIGHTS.distance * 0.5  // unknown = half credit
  if (distanceMiles <= 0.1)  return WEIGHTS.distance
  if (distanceMiles <= 0.25) return WEIGHTS.distance * 0.9
  if (distanceMiles <= 0.5)  return WEIGHTS.distance * 0.7
  if (distanceMiles <= 0.75) return WEIGHTS.distance * 0.4
  if (distanceMiles <= 1.0)  return WEIGHTS.distance * 0.1
  return 0
}

// ── Sqft variance scoring ─────────────────────────────────────────────────────
// Full points within 5% variance; zero at 30%+.

function scoreSqft(subjectSqft: number | null, compSqft: number | null): { score: number; variancePct: number | null } {
  if (!subjectSqft || !compSqft) return { score: WEIGHTS.sqft * 0.5, variancePct: null }
  const variancePct = Math.abs(compSqft - subjectSqft) / subjectSqft * 100
  let score: number
  if (variancePct <= 5)  score = WEIGHTS.sqft
  else if (variancePct <= 10) score = WEIGHTS.sqft * 0.8
  else if (variancePct <= 15) score = WEIGHTS.sqft * 0.6
  else if (variancePct <= 20) score = WEIGHTS.sqft * 0.3
  else if (variancePct <= 30) score = WEIGHTS.sqft * 0.1
  else score = 0
  return { score: parseFloat(score.toFixed(2)), variancePct: parseFloat(variancePct.toFixed(1)) }
}

// ── Beds/baths scoring ────────────────────────────────────────────────────────

function scoreBedssBaths(
  subjectBeds: number | null, compBeds: number | null,
  subjectBaths: number | null, compBaths: number | null,
): { score: number; bedsDiff: number | null; bathsDiff: number | null } {
  const bedsDiff  = (compBeds  != null && subjectBeds  != null) ? Math.abs(compBeds  - subjectBeds)  : null
  const bathsDiff = (compBaths != null && subjectBaths != null) ? Math.abs(compBaths - subjectBaths) : null

  if (bedsDiff == null && bathsDiff == null) return { score: WEIGHTS.bedsBaths * 0.5, bedsDiff: null, bathsDiff: null }

  const bedsScore  = bedsDiff  == null ? 0.5 : bedsDiff  === 0 ? 1 : bedsDiff  <= 1 ? 0.6 : 0.2
  const bathsScore = bathsDiff == null ? 0.5 : bathsDiff === 0 ? 1 : bathsDiff <= 1 ? 0.6 : 0.2
  const combined   = (bedsScore + bathsScore) / 2

  return {
    score:     parseFloat((WEIGHTS.bedsBaths * combined).toFixed(2)),
    bedsDiff,
    bathsDiff,
  }
}

// ── Year-built scoring ────────────────────────────────────────────────────────

function scoreYearBuilt(subjectYear: number | null, compYear: number | null): { score: number; diff: number | null } {
  if (!subjectYear || !compYear) return { score: WEIGHTS.yearBuilt * 0.5, diff: null }
  const diff = Math.abs(compYear - subjectYear)
  const score =
    diff === 0  ? WEIGHTS.yearBuilt :
    diff <= 3   ? WEIGHTS.yearBuilt * 0.9 :
    diff <= 7   ? WEIGHTS.yearBuilt * 0.7 :
    diff <= 15  ? WEIGHTS.yearBuilt * 0.4 :
    diff <= 25  ? WEIGHTS.yearBuilt * 0.1 :
                  0
  return { score: parseFloat(score.toFixed(2)), diff }
}

// ── Recency scoring (sold comps only) ─────────────────────────────────────────
// More recent sales are more relevant. Max points within 30 days; zero at 365+.

function scoreRecency(closeDate: string | null): { score: number; daysSinceSold: number | null } {
  if (!closeDate) return { score: 0, daysSinceSold: null }
  const daysSinceSold = Math.floor((Date.now() - new Date(closeDate).getTime()) / 86400000)
  const score =
    daysSinceSold <= 30  ? WEIGHTS.recency :
    daysSinceSold <= 60  ? WEIGHTS.recency * 0.9 :
    daysSinceSold <= 90  ? WEIGHTS.recency * 0.75 :
    daysSinceSold <= 180 ? WEIGHTS.recency * 0.5 :
    daysSinceSold <= 365 ? WEIGHTS.recency * 0.2 :
                           0
  return { score: parseFloat(score.toFixed(2)), daysSinceSold }
}

// ── Main similarity scorer ────────────────────────────────────────────────────

function computeSimilarity(
  subject: PropertySummary,
  comp:    NormalizedComp,
  requestedStatus: CompStatus | null,
): CompSelectionBreakdown {
  const distScore   = scoreDistance(comp.distanceMiles)
  const sqftResult  = scoreSqft(subject.sqft, comp.sqft)
  const bbResult    = scoreBedssBaths(subject.beds, comp.beds, subject.baths, comp.baths)
  const yearResult  = scoreYearBuilt(subject.yearBuilt, comp.yearBuilt)
  const recResult   = comp.compStatus === 'sold' ? scoreRecency(comp.closeDate) : { score: 0, daysSinceSold: null }

  const typeScore   = (comp.propertyType && subject.propertyType &&
    comp.propertyType.toLowerCase() === subject.propertyType.toLowerCase())
      ? WEIGHTS.propertyType : 0

  const statusScore = (requestedStatus && comp.compStatus === requestedStatus)
    ? WEIGHTS.status : 0

  const sameSubdivision = comp.subdivision != null && (comp.subdivision.length > 0)
    ? null  // subdivision matching requires subject subdivision — not yet in PropertySummary
    : null
  const subdivScore = 0  // reserved for Sprint 4 when subject.subdivision is available

  const total = parseFloat((
    distScore + typeScore + sqftResult.score + bbResult.score +
    yearResult.score + recResult.score + statusScore + subdivScore
  ).toFixed(1))

  return {
    version: SELECTION_VERSION,
    total:   Math.min(100, total),
    components: {
      distance:     parseFloat(distScore.toFixed(2)),
      propertyType: typeScore,
      sqft:         sqftResult.score,
      bedsBaths:    bbResult.score,
      yearBuilt:    yearResult.score,
      recency:      recResult.score,
      status:       statusScore,
      subdivision:  subdivScore,
    },
    inputs: {
      distanceMiles:   comp.distanceMiles,
      sqftVariancePct: sqftResult.variancePct,
      bedsDiff:        bbResult.bedsDiff,
      bathsDiff:       bbResult.bathsDiff,
      yearBuiltDiff:   yearResult.diff,
      daysSinceSold:   recResult.daysSinceSold,
      sameType:        typeScore > 0,
      sameSubdivision,
    },
  }
}

// ── Cache TTL constants ───────────────────────────────────────────────────────

const ACTIVE_COMP_TTL_H  = 24    // active comps stale after 24h
const SOLD_COMP_TTL_H    = 24 * 7 // sold comps stale after 7 days

// ── Load cached comps ─────────────────────────────────────────────────────────

async function loadCachedComps(
  subjectPropertyId: string,
): Promise<{ rows: Record<string, unknown>[]; fromCache: boolean }> {
  const { data } = await serviceClient
    .from('property_comparables')
    .select('*')
    .eq('subject_property_id', subjectPropertyId)
    .order('similarity_score', { ascending: false })

  if (!data?.length) return { rows: [], fromCache: false }

  // Consider the comp set stale if ANY active comp is older than ACTIVE_COMP_TTL_H
  const now = Date.now()
  const activeStale = data
    .filter(r => r.comp_status === 'active' || r.comp_status === 'pending')
    .some(r => now - new Date(r.generated_at as string).getTime() > ACTIVE_COMP_TTL_H * 3600000)

  if (activeStale) return { rows: data, fromCache: false }
  return { rows: data, fromCache: true }
}

// ── Persist comp rows ─────────────────────────────────────────────────────────

async function persistComps(
  subjectPropertyId: string,
  comps:             NormalizedComp[],
  subject:           PropertySummary,
  requestedStatus:   CompStatus | null,
): Promise<PropertyComparable[]> {
  if (!comps.length) return []

  const now     = new Date().toISOString()
  const expires = new Date(Date.now() + 90 * 24 * 3600000).toISOString()

  const rows = comps.map(comp => {
    const breakdown = computeSimilarity(subject, comp, requestedStatus)
    const relationship = comp.compStatus === 'active' ? 'active_comp'
                       : comp.compStatus === 'pending' ? 'pending_comp'
                       : comp.compStatus === 'rental' ? 'rental_comp'
                       : 'closed_comp'

    return {
      subject_property_id:  subjectPropertyId,
      comp_mls_number:      comp.mlsNumber,
      provenance_id:        comp.provenanceId,
      comp_address:         comp.address,
      comp_status:          comp.compStatus,
      relationship,
      list_price:           comp.listPrice,
      close_price:          comp.closePrice,
      sqft:                 comp.sqft,
      beds:                 comp.beds,
      baths:                comp.baths,
      year_built:           comp.yearBuilt,
      lot_sqft:             comp.lotSqft,
      days_on_market:       comp.daysOnMarket,
      price_per_sqft:       comp.pricePerSqft,
      distance_miles:       comp.distanceMiles,
      list_date:            comp.listDate,
      close_date:           comp.closeDate,
      subdivision:          comp.subdivision,
      property_type:        comp.propertyType,
      similarity_score:     breakdown.total,
      similarity_breakdown: breakdown,
      selection_version:    SELECTION_VERSION,
      source_timestamp:     comp.fetchedAt,
      source:               'reapi',
      generated_at:         now,
      expires_at:           expires,
    }
  })

  const { data: inserted, error } = await serviceClient
    .from('property_comparables')
    .upsert(rows, { onConflict: 'subject_property_id,provenance_id', ignoreDuplicates: false })
    .select('*')

  if (error) {
    console.error(`[Comparables] persist failed for property ${subjectPropertyId}:`, error.message)
    return []
  }

  return (inserted ?? []).map(rowToPropertyComparable)
}

// ── Row → PropertyComparable ──────────────────────────────────────────────────

function rowToPropertyComparable(row: Record<string, unknown>): PropertyComparable {
  return {
    id:                  row.id as string,
    subjectPropertyId:   row.subject_property_id as string,
    compPropertyId:      (row.comp_property_id as string | null) ?? null,
    compMlsNumber:       (row.comp_mls_number as string | null) ?? null,
    provenanceId:        (row.provenance_id as string | null) ?? null,
    compAddress:         (row.comp_address as PropertyComparable['compAddress']) ?? { street: null, city: null, state: null, zip: null },
    compStatus:          (row.comp_status as CompStatus | null) ?? null,
    relationship:        (row.relationship as string) ?? 'closed_comp',
    listPrice:           (row.list_price as number | null) ?? null,
    closePrice:          (row.close_price as number | null) ?? null,
    sqft:                (row.sqft as number | null) ?? null,
    beds:                (row.beds as number | null) ?? null,
    baths:               (row.baths as number | null) ?? null,
    yearBuilt:           (row.year_built as number | null) ?? null,
    lotSqft:             (row.lot_sqft as number | null) ?? null,
    daysOnMarket:        (row.days_on_market as number | null) ?? null,
    pricePerSqft:        (row.price_per_sqft as number | null) ?? null,
    distanceMiles:       (row.distance_miles as number | null) ?? null,
    listDate:            (row.list_date as string | null) ?? null,
    closeDate:           (row.close_date as string | null) ?? null,
    subdivision:         (row.subdivision as string | null) ?? null,
    propertyType:        (row.property_type as string | null) ?? null,
    similarityScore:     (row.similarity_score as number | null) ?? null,
    similarityBreakdown: (row.similarity_breakdown as CompSelectionBreakdown | null) ?? null,
    selectionVersion:    (row.selection_version as string) ?? SELECTION_VERSION,
    sourceTimestamp:     (row.source_timestamp as string | null) ?? null,
    source:              (row.source as string) ?? 'reapi',
    generatedAt:         row.generated_at as string,
    expiresAt:           row.expires_at as string,
    createdAt:           row.created_at as string,
  }
}

// ── Summary derivation ────────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function buildSummary(
  active: PropertyComparable[],
  pending: PropertyComparable[],
  sold: PropertyComparable[],
): ComparableIntelligence['summary'] {
  const activePrices = active.map(c => c.listPrice).filter((p): p is number => p != null)
  const soldPrices   = sold.map(c => c.closePrice ?? c.listPrice).filter((p): p is number => p != null)
  const ppsqftAll    = [...active, ...sold].map(c => c.pricePerSqft).filter((p): p is number => p != null)
  const domAll       = [...active, ...sold].map(c => c.daysOnMarket).filter((d): d is number => d != null)

  const sampleSize = active.length + pending.length + sold.length

  const confidence: 'high' | 'medium' | 'low' =
    sampleSize >= 30 ? 'high' : sampleSize >= 10 ? 'medium' : 'low'

  // Suggested value range: only when we have ≥3 sold comps
  let suggestedValueRange: { low: number; high: number } | null = null
  if (soldPrices.length >= 3) {
    const sorted = [...soldPrices].sort((a, b) => a - b)
    const q1 = sorted[Math.floor(sorted.length * 0.25)]
    const q3 = sorted[Math.ceil(sorted.length * 0.75) - 1]
    if (q1 != null && q3 != null) {
      suggestedValueRange = {
        low:  Math.round(q1 * 100) / 100,
        high: Math.round(q3 * 100) / 100,
      }
    }
  }

  // Oldest comp date for staleness warning
  const allDates = [...active, ...pending, ...sold]
    .map(c => c.generatedAt)
    .filter(Boolean)
    .sort()
  const oldestCompDate = allDates[0] ?? null

  return {
    activeCount:         active.length,
    pendingCount:        pending.length,
    soldCount:           sold.length,
    medianActivePrice:   median(activePrices),
    medianSoldPrice:     median(soldPrices),
    medianPricePerSqft:  median(ppsqftAll),
    medianDom:           median(domAll),
    suggestedValueRange,
    sampleSize,
    confidence,
    oldestCompDate,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GetCompsOptions {
  force?:           boolean
  radiusMiles?:     number
  maxComps?:        number
  soldWithinDays?:  number
  billing?:         BillingContext
}

/**
 * Get comparable intelligence for a property.
 *
 * Cache check: returns cached rows if still within TTL (active <24h, sold <7d).
 * Cache miss: fetches from REAPI, scores, deduplicates, persists, returns result.
 *
 * @param propertyId  - Subject property ID
 * @param subject     - Subject property summary (beds/baths/sqft/yearBuilt for scoring)
 * @param opts        - Override defaults (radius, max comps, sold window, force refresh)
 */
export async function getComparableIntelligence(
  propertyId: string,
  subject:    PropertySummary,
  opts:       GetCompsOptions = {},
): Promise<ComparableIntelligence> {
  const fetchedAt = new Date().toISOString()

  // ── 1. Cache check ────────────────────────────────────────────────────────
  if (!opts.force) {
    const { rows, fromCache } = await loadCachedComps(propertyId)
    if (fromCache && rows.length > 0) {
      return assembleIntelligence(propertyId, rows.map(rowToPropertyComparable), fetchedAt, true)
    }
  }

  // ── 2. Authorize via ProviderGateway before any REAPI call ───────────────
  // Fail closed: if authorization fails, serve whatever is in DB (may be stale).
  const billing = opts.billing ?? BACKGROUND_CONTEXT
  const requestId = crypto.randomUUID()

  const auth = await providerGateway.authorizeFeature({
    request_id:  requestId,
    account_id:  billing.account_id,
    feature_key: 'comps_refresh',
    pool_key:    billing.pool_key,
  })

  if (!auth.success) {
    const { rows } = await loadCachedComps(propertyId)
    return assembleIntelligence(propertyId, rows.map(rowToPropertyComparable), fetchedAt, true)
  }

  // ── 3. Build fetch query ──────────────────────────────────────────────────
  const baseQuery: CompFetchQuery = {
    address:       subject.address,
    city:          subject.city,
    state:         subject.state,
    zip:           subject.zip,
    propertyType:  subject.propertyType ?? undefined,
    radiusMiles:   opts.radiusMiles ?? 0.5,
    maxComps:      opts.maxComps ?? 10,
    soldWithinDays: opts.soldWithinDays ?? 180,
  }

  // ── 4. Fetch all statuses in parallel ─────────────────────────────────────
  // Three calls: active, pending, sold. Total cost ~$0.15 for a full refresh.
  // No photos in any call.
  const [activeResult, pendingResult, soldResult] = await Promise.all([
    fetchCompsFromReapi({ ...baseQuery, status: 'active' }),
    fetchCompsFromReapi({ ...baseQuery, status: 'pending' }),
    fetchCompsFromReapi({ ...baseQuery, status: 'sold' }),
  ])

  // ── 5. Finalize reservation with actual cost ──────────────────────────────
  const anySuccess  = activeResult.success || pendingResult.success || soldResult.success
  const actualCost  = [activeResult, pendingResult, soldResult]
    .filter(r => r.success)
    .reduce((sum, r) => sum + r.costCents, 0)
  const maxDuration = Math.max(activeResult.durationMs, pendingResult.durationMs, soldResult.durationMs)

  await providerGateway.finalize({
    request_id:        requestId,
    actual_cost_cents: actualCost,
    success:           anySuccess,
    cache_hit:         false,
    duration_ms:       maxDuration,
  })

  const allComps = [
    ...activeResult.comps,
    ...pendingResult.comps,
    ...soldResult.comps,
  ]

  // ── 6. Deduplicate by provenanceId before persisting ──────────────────────
  const seen    = new Set<string>()
  const unique  = allComps.filter(c => {
    if (seen.has(c.provenanceId)) return false
    seen.add(c.provenanceId)
    return true
  })

  // ── 7. Score and persist ──────────────────────────────────────────────────
  await persistComps(propertyId, unique, subject, null)

  // ── 8. Load fresh rows from DB (includes IDs and timestamps) ─────────────
  const { rows: freshRows } = await loadCachedComps(propertyId)
  const comps = freshRows.map(rowToPropertyComparable)

  return assembleIntelligence(propertyId, comps, fetchedAt, false)
}

// ── Assemble into ComparableIntelligence ──────────────────────────────────────

function assembleIntelligence(
  propertyId: string,
  comps:      PropertyComparable[],
  fetchedAt:  string,
  fromCache:  boolean,
): ComparableIntelligence {
  // Sort each group by similarity score descending
  const byStatus = (status: CompStatus) =>
    comps
      .filter(c => c.compStatus === status)
      .sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0))

  const active  = byStatus('active')
  const pending = byStatus('pending')
  const sold    = byStatus('sold')
  const rental  = byStatus('rental')

  return {
    propertyId,
    active,
    pending,
    sold,
    rental,
    summary: buildSummary(active, pending, sold),
    fetchedAt,
    fromCache,
  }
}
