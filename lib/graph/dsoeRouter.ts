/**
 * DSOE Intelligence Router — Phase 6.5
 *
 * Intent-based routing engine. Each intent has its own ordered provider stack
 * and field-authority rules. This is separate from lib/dsoe.ts (the field
 * provenance logger) — that layer records WHAT came from WHERE after the fact;
 * this layer decides WHICH sources to consult and in what order.
 *
 * Architecture:
 *   Caller → resolveDsoe(query) → per-intent provider stack → merged result
 *   Result → propertyGraph.ts (reads) or propertyService.ts (stores)
 *
 * Adding a new provider (e.g., Clerk of Court):
 *   1. Create lib/graph/providers/clerkOfCourt.ts
 *   2. Import and register it in PROVIDER_REGISTRY below
 *   3. Add its id to the relevant INTENT_STACKS entries
 *   4. Add its authoritative_fields to the provider definition
 */

import { mlsReapiProvider }  from './providers/mlsReapi'
import { recordFieldSources } from '@/lib/dsoe'
import { logDSOERequest }     from '@/lib/dsoe'
import type {
  DsoeIntent,
  DsoeQuery,
  DsoeResult,
  DsoeProviderDef,
  DsoeProviderResult,
} from './types'

// ── Provider registry ─────────────────────────────────────────────────────────
// Sprint 1: two providers. Sprint 2+ adds: clerk-of-court, tax-collector,
// official-records, rentcast, reapi-general (non-MLS fields).

const PROVIDER_REGISTRY: Record<string, DsoeProviderDef> = {
  'mls-reapi':  mlsReapiProvider,
}

// ── Per-intent provider stacks ────────────────────────────────────────────────
// Order within each stack is the priority order for that intent.
// Providers not relevant to an intent are never called (saves cost + latency).
// 'full_profile' calls all providers and merges by field authority.

const INTENT_STACKS: Record<DsoeIntent, string[]> = {
  listing:      ['mls-reapi'],
  ownership:    ['mls-reapi'],
  legal_status: ['mls-reapi'],
  valuation:    ['mls-reapi'],
  comps:        ['mls-reapi'],
  full_profile: ['mls-reapi'],
}

// ── Field-authority merge ─────────────────────────────────────────────────────
// For 'full_profile', each field is resolved from its authoritative provider.
// If the authoritative provider didn't return a value, fall back to other providers.

function buildAuthorityIndex(): Map<string, string> {
  const index = new Map<string, string>()
  for (const provider of Object.values(PROVIDER_REGISTRY)) {
    for (const field of provider.authoritative_fields) {
      // Later registrations win if there's a conflict — providers registered
      // earlier yield to later ones on shared field names.
      index.set(field, provider.id)
    }
  }
  return index
}

const FIELD_AUTHORITY_INDEX = buildAuthorityIndex()

function mergeByAuthority(
  results: DsoeProviderResult[],
  intent: DsoeIntent,
): Record<string, unknown> {
  if (intent !== 'full_profile') {
    // For single-intent queries, just merge all results — first non-null wins per field
    const merged: Record<string, unknown> = {}
    for (const result of results) {
      if (!result.success) continue
      for (const [key, value] of Object.entries(result.data)) {
        if (value != null && merged[key] == null) {
          merged[key] = value
        }
      }
    }
    return merged
  }

  // full_profile: apply field-authority rules
  const resultMap = new Map(results.map(r => [r.providerId, r]))
  const merged: Record<string, unknown> = {}

  // First pass: authority-assigned fields
  for (const [field, authorityProviderId] of FIELD_AUTHORITY_INDEX) {
    const authorityResult = resultMap.get(authorityProviderId)
    if (authorityResult?.success && authorityResult.data[field] != null) {
      merged[field] = authorityResult.data[field]
    }
  }

  // Second pass: fill remaining fields from any provider (first-wins)
  for (const result of results) {
    if (!result.success) continue
    for (const [key, value] of Object.entries(result.data)) {
      if (value != null && merged[key] == null) {
        merged[key] = value
      }
    }
  }

  return merged
}

// ── Main routing function ─────────────────────────────────────────────────────

/**
 * Resolve property data using the intent-based provider stack.
 *
 * Instrumentation emitted per call:
 *   - cacheHit per provider (Postgres TTL check; Redis is future)
 *   - skipReason for providers not called
 *   - avoidedCostCents for skipped paid providers
 *   - selectedProvider = first provider that returned data
 *   - totalCostCents / avoidedCostCents on the DsoeResult
 *
 * Does NOT write to any table — callers own their write strategy.
 * Does NOT throw — failed providers are recorded in result.providers[].error.
 */
export async function resolveDsoe(query: DsoeQuery): Promise<DsoeResult> {
  const start = Date.now()
  const providerIds = INTENT_STACKS[query.intent] ?? []
  const results: DsoeProviderResult[] = []
  let totalAvoidedCents = 0

  for (const providerId of providerIds) {
    const provider = PROVIDER_REGISTRY[providerId]
    if (!provider) continue

    if (!provider.supports.includes(query.intent)) {
      results.push({
        providerId,
        data:        {},
        success:     false,
        durationMs:  0,
        skipReason:  'intent_not_supported',
        avoidedCostCents: 0,
      })
      continue
    }

    const result = await provider.fetch(query)
    results.push({ ...result, cacheHit: false, skipReason: null })

    // For non-full_profile intents, stop after the first successful provider.
    // Mark remaining providers as cache_warm (we have what we need).
    if (result.success && query.intent !== 'full_profile') {
      const isListingDone  = result.listing != null
      const isOwnershipDone = query.intent === 'ownership'
      if (isListingDone || isOwnershipDone) {
        // Mark remaining providers as skipped — log the avoided cost
        const remaining = providerIds.slice(providerIds.indexOf(providerId) + 1)
        for (const skippedId of remaining) {
          const skipped = PROVIDER_REGISTRY[skippedId]
          const avoided = skipped?.estimatedCostCents ?? 0
          totalAvoidedCents += avoided
          results.push({
            providerId: skippedId,
            data:       {},
            success:    false,
            durationMs: 0,
            skipReason: 'cache_warm',
            avoidedCostCents: avoided,
          })
        }
        break
      }
    }
  }

  const merged = mergeByAuthority(results, query.intent)

  // Record provenance in DSOE field-source log (existing logging layer)
  const successfulResults = results.filter(r => r.success && Object.keys(r.data).length > 0)
  for (const result of successfulResults) {
    const provider = PROVIDER_REGISTRY[result.providerId]
    if (!provider || !Object.keys(result.data).length) continue
    void recordFieldSources(query.propertyId, result.data, {
      source:      result.providerId,
      sourceType:  provider.group === 'public_records' ? 'public' : 'paid',
      sourceLabel: result.providerId,
      confidence:  provider.confidence,
    }).catch(() => {})
  }

  // Cost accounting from provider metadata
  const totalDuration  = Date.now() - start
  const cacheHits      = results.filter(r => r.cacheHit).length
  const countyHits     = results.filter(r => r.success && PROVIDER_REGISTRY[r.providerId]?.group === 'public_records').length
  const premiumHits    = results.filter(r => r.success && PROVIDER_REGISTRY[r.providerId]?.group !== 'public_records').length
  const tier           = countyHits > 0 ? 2 : premiumHits > 0 ? 3 : 1
  const totalCostCents = results
    .filter(r => r.success && !r.cacheHit)
    .reduce((sum, r) => sum + (PROVIDER_REGISTRY[r.providerId]?.estimatedCostCents ?? 0), 0)

  logDSOERequest({
    propertyId:     query.propertyId,
    tier:           tier as 1 | 2 | 3,
    source:         results.filter(r => r.success).map(r => r.providerId).join(','),
    fieldsResolved: Object.keys(merged).length,
    cacheHits,
    countyHits,
    premiumHits,
    costCents:      totalCostCents,
    durationMs:     totalDuration,
  })

  const listing = results.find(r => r.listing != null)?.listing ?? null

  return {
    propertyId:       query.propertyId,
    intent:           query.intent,
    providers:        results,
    merged,
    listing:          listing ?? undefined,
    resolvedAt:       new Date().toISOString(),
    totalCostCents,
    avoidedCostCents: totalAvoidedCents,
  }
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/** Check if MLS data is likely available for this property */
export function mlsProviderConfigured(): boolean {
  return !!process.env.REAPI_KEY
}

/** List all registered providers with cost metadata — for diagnostics and cost reporting */
export function listProviders(): {
  id:                  string
  group:               string
  supports:            string[]
  estimatedCostCents:  number
  freshnessTtlHours:   number
  confidence:          number
  supportsBatch:       boolean
  supportsWebhooks:    boolean
  supportsManualRefresh: boolean
}[] {
  return Object.values(PROVIDER_REGISTRY).map(p => ({
    id:                   p.id,
    group:                p.group,
    supports:             p.supports,
    estimatedCostCents:   p.estimatedCostCents,
    freshnessTtlHours:    p.freshnessTtlHours,
    confidence:           p.confidence,
    supportsBatch:        p.supportsBatch,
    supportsWebhooks:     p.supportsWebhooks,
    supportsManualRefresh: p.supportsManualRefresh,
  }))
}

/**
 * Returns the estimated cost (cents) of running a given intent through its full
 * provider stack — useful for pre-flight cost checks before triggering enrichment.
 *
 * Principle 6 (lazy enrichment): callers can check cost before deciding to enrich.
 */
export function estimateIntentCost(intent: DsoeIntent): number {
  const providerIds = INTENT_STACKS[intent] ?? []
  return providerIds.reduce((sum, id) => {
    return sum + (PROVIDER_REGISTRY[id]?.estimatedCostCents ?? 0)
  }, 0)
}
