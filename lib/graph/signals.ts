/**
 * Deterministic Opportunity Signal Rules — Sprint 2
 *
 * Pure functions. No DB calls, no side effects.
 * Input: current listing state + context flags.
 * Output: list of UpsertOpportunitySignalInput for caller to persist.
 *
 * Design rules:
 *   - Every rule must be deterministic — same inputs → same outputs always
 *   - No AI, no ML, no probabilistic scoring here
 *   - Each signal includes the evidence that triggered it (signalData)
 *   - Confidence reflects how certain we are given available data quality
 *   - Signals from other domains (county PA, clerk of court) are NOT overwritten here;
 *     this module only emits signals derivable from MLS listing data
 *
 * Signal sources covered by this module: 'mls' only.
 * County PA signals (high_equity, absentee_owner, etc.) come from their own module.
 */

import type { UpsertOpportunitySignalInput, ListingIntelligence, UnifiedListing } from './types'

export const HIGH_DOM_THRESHOLD          = 90   // days — "high days on market"
export const MULTIPLE_REDUCTIONS_THRESHOLD = 2  // # of reductions = "multiple"

/**
 * Derives all opportunity signals from MLS listing intelligence.
 *
 * Returns an array of signal inputs ready for recordOpportunitySignal().
 * Includes deactivation signals (isActive: false) for signals that no longer apply.
 */
export function deriveMlsSignals(
  listing: Pick<ListingIntelligence, 'status' | 'daysOnMarket' | 'priceReductionCount' | 'hoaAmount'>,
  opts: {
    isBackOnMarket: boolean
  },
): UpsertOpportunitySignalInput[] {
  const signals: UpsertOpportunitySignalInput[] = []
  const { isBackOnMarket } = opts
  const dom        = listing.daysOnMarket ?? 0
  const reductions = listing.priceReductionCount ?? 0
  const status     = listing.status ?? 'Unknown'

  // ── MLS Active ──────────────────────────────────────────────────────────────
  signals.push({
    propertyId:   '',   // filled by caller
    signalType:   'mls_active',
    signalSource: 'mls',
    isActive:     status === 'Active',
    confidence:   0.95,
    signalData:   { status, daysOnMarket: dom },
  })

  // ── Pending MLS ─────────────────────────────────────────────────────────────
  signals.push({
    propertyId:   '',
    signalType:   'pending_mls',
    signalSource: 'mls',
    isActive:     status === 'Pending',
    confidence:   0.95,
    signalData:   { status },
  })

  // ── Expired Listing ─────────────────────────────────────────────────────────
  signals.push({
    propertyId:   '',
    signalType:   'expired_listing',
    signalSource: 'mls',
    isActive:     status === 'Expired',
    confidence:   0.95,
    signalData:   { status },
  })

  // ── High DOM (long_dom) ─────────────────────────────────────────────────────
  // Only applies when listing is active — stale DOM on a closed listing is not actionable
  if (status === 'Active' || status === 'Pending') {
    signals.push({
      propertyId:   '',
      signalType:   'high_dom',
      signalSource: 'mls',
      isActive:     dom >= HIGH_DOM_THRESHOLD,
      confidence:   0.9,
      signalData:   { daysOnMarket: dom, threshold: HIGH_DOM_THRESHOLD },
    })
  }

  // ── Price Reduced ───────────────────────────────────────────────────────────
  signals.push({
    propertyId:   '',
    signalType:   'mls_price_reduced',
    signalSource: 'mls',
    isActive:     reductions >= 1,
    confidence:   0.92,
    signalData:   { priceReductionCount: reductions },
  })

  // ── Multiple Price Reductions ───────────────────────────────────────────────
  signals.push({
    propertyId:   '',
    signalType:   'multiple_price_reductions',
    signalSource: 'mls',
    isActive:     reductions >= MULTIPLE_REDUCTIONS_THRESHOLD,
    confidence:   0.88,
    signalData:   {
      priceReductionCount: reductions,
      threshold:           MULTIPLE_REDUCTIONS_THRESHOLD,
    },
  })

  // ── Back on Market ──────────────────────────────────────────────────────────
  signals.push({
    propertyId:   '',
    signalType:   'back_on_market',
    signalSource: 'mls',
    isActive:     isBackOnMarket && status === 'Active',
    confidence:   0.85,
    signalData:   { backOnMarket: isBackOnMarket },
  })

  // ── No HOA ─────────────────────────────────────────────────────────────────
  // Only assert if the MLS explicitly reported $0 (null = not reported, don't assume)
  if (listing.hoaAmount === 0) {
    signals.push({
      propertyId:   '',
      signalType:   'no_hoa',
      signalSource: 'mls',
      isActive:     true,
      confidence:   0.88,
      signalData:   { hoaAmount: 0, source: 'mls_explicit' },
    })
  }

  return signals
}

/**
 * Attach propertyId to all signals returned by deriveMlsSignals.
 * Caller must do this before passing to recordOpportunitySignal().
 */
export function attachPropertyId(
  signals:    UpsertOpportunitySignalInput[],
  propertyId: string,
): UpsertOpportunitySignalInput[] {
  return signals.map(s => ({ ...s, propertyId }))
}

/**
 * Derives MLS signals from a raw UnifiedListing (before writing to listing_intelligence).
 * Useful when we want to emit signals at the same time we process the raw provider result.
 */
export function deriveMlsSignalsFromListing(
  listing: UnifiedListing,
  opts: { isBackOnMarket: boolean; existingHoaAmount?: number | null },
): UpsertOpportunitySignalInput[] {
  const dom        = listing.daysOnMarket ?? 0
  const reductions = listing.priceReductionCount ?? 0
  const status     = listing.status ?? 'Unknown'
  const hoaAmount  = opts.existingHoaAmount ?? listing.hoaAmount

  return deriveMlsSignals(
    { status, daysOnMarket: dom, priceReductionCount: reductions, hoaAmount },
    { isBackOnMarket: opts.isBackOnMarket },
  )
}
