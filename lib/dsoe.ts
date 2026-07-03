/**
 * Data Source Optimization Engine (DSOE)
 *
 * Routes property data through the optimal source tier:
 *   Tier 1 — NextKey cache (property_freshness gating)
 *   Tier 2 — Public records (county PA adapters)
 *   Tier 3 — Premium APIs (REAPI, MLS, RentCast, etc.)
 *
 * Exports:
 *   recordFieldSources  — write field-level provenance after any enrichment
 *   logDSOERequest      — write one row to dsoe_request_log for metrics
 *   getDataPassport     — read full provenance map for a property
 *   getDSOEMetrics      — aggregate stats for the dashboard widget
 */

import { serviceClient } from './supabase-service'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FieldSource {
  field_name:   string
  field_value:  string | null
  source:       string
  source_type:  'internal' | 'public' | 'paid'
  source_label: string | null
  confidence:   number | null
  collected_at: string
}

export interface DataPassport {
  property_id:  string
  fields:       FieldSource[]
  tier_summary: { internal: number; public: number; paid: number }
  last_updated: string | null
}

export interface DSMetrics {
  total_requests:           number
  tier1_hits:               number
  tier2_hits:               number
  tier3_hits:               number
  cache_hit_rate:           number
  estimated_savings_cents:  number
  avg_response_time_ms:     number | null
  total_field_sources:      number
}

// ── Field-level provenance ────────────────────────────────────────────────────

export type FieldSourceMeta = {
  source:      string          // e.g. 'broward-pa', 'reapi', 'miami-dade-pa'
  sourceType:  'internal' | 'public' | 'paid'
  sourceLabel: string          // e.g. 'Broward County PA', 'RealEstateAPI'
  confidence:  number          // 0–100 integer
}

/**
 * Record which source provided which field values for a property.
 * Upserts — a newer, more confident source replaces an older one for the same field.
 * Pass any flat Record<string, unknown>; null/undefined values are skipped.
 */
export async function recordFieldSources(
  propertyId: string,
  fields:     Record<string, unknown>,
  meta:       FieldSourceMeta,
): Promise<void> {
  const now = new Date().toISOString()
  const rows = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([field_name, v]) => ({
      property_id:  propertyId,
      field_name,
      field_value:  String(v),
      source:       meta.source,
      source_type:  meta.sourceType,
      source_label: meta.sourceLabel,
      confidence:   Math.min(1, meta.confidence / 100),
      collected_at: now,
    }))

  if (!rows.length) return

  await serviceClient
    .from('property_field_sources')
    .upsert(rows, { onConflict: 'property_id,field_name' })
}

// ── Request logging ────────────────────────────────────────────────────────────

export function logDSOERequest(opts: {
  propertyId:     string | null
  tier:           1 | 2 | 3
  source:         string
  fieldsResolved: number
  cacheHits:      number
  countyHits:     number
  premiumHits:    number
  costCents:      number
  durationMs:     number
}): void {
  void serviceClient.from('dsoe_request_log').insert({
    property_id:     opts.propertyId,
    tier_used:       opts.tier,
    source:          opts.source,
    fields_resolved: opts.fieldsResolved,
    cache_hits:      opts.cacheHits,
    county_hits:     opts.countyHits,
    premium_hits:    opts.premiumHits,
    cost_cents:      opts.costCents,
    duration_ms:     opts.durationMs,
  })
}

// ── Data Passport ─────────────────────────────────────────────────────────────

export async function getDataPassport(propertyId: string): Promise<DataPassport | null> {
  const { data } = await serviceClient
    .from('property_field_sources')
    .select('field_name, field_value, source, source_type, source_label, confidence, collected_at')
    .eq('property_id', propertyId)
    .order('field_name')

  if (!data?.length) return null

  const tierSummary = { internal: 0, public: 0, paid: 0 }
  let lastUpdated: string | null = null

  for (const f of data) {
    tierSummary[f.source_type as keyof typeof tierSummary]++
    if (!lastUpdated || f.collected_at > lastUpdated) lastUpdated = f.collected_at
  }

  return {
    property_id:  propertyId,
    fields:       data as FieldSource[],
    tier_summary: tierSummary,
    last_updated: lastUpdated,
  }
}

// ── Metrics ────────────────────────────────────────────────────────────────────

// Estimated cost per REAPI call in cents (used to calculate savings from county hits)
const REAPI_COST_CENTS = 5

export async function getDSOEMetrics(): Promise<DSMetrics> {
  const [requestsRes, fieldCountRes] = await Promise.all([
    serviceClient
      .from('dsoe_request_log')
      .select('tier_used, county_hits, duration_ms'),
    serviceClient
      .from('property_field_sources')
      .select('id', { count: 'exact', head: true }),
  ])

  const requests = requestsRes.data ?? []
  const total    = requests.length
  const tier1    = requests.filter(r => r.tier_used === 1).length
  const tier2    = requests.filter(r => r.tier_used === 2).length
  const tier3    = requests.filter(r => r.tier_used === 3).length

  const totalCountyHits = requests.reduce((n, r) => n + (r.county_hits ?? 0), 0)
  const estimatedSavings = totalCountyHits * REAPI_COST_CENTS

  const durations = requests
    .filter(r => typeof r.duration_ms === 'number')
    .map(r => r.duration_ms as number)
  const avgDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null

  return {
    total_requests:          total,
    tier1_hits:              tier1,
    tier2_hits:              tier2,
    tier3_hits:              tier3,
    cache_hit_rate:          total ? tier1 / total : 0,
    estimated_savings_cents: estimatedSavings,
    avg_response_time_ms:    avgDuration,
    total_field_sources:     fieldCountRes.count ?? 0,
  }
}
