/**
 * Property Scoring Engine v1 — Sprint 2
 *
 * Deterministic, non-AI, versioned scoring formulas.
 * Every score is accompanied by a full ScoreBreakdown so it is never
 * an unexplained black box.
 *
 * Two scores:
 *   Market Position Score (0–100)
 *     "How competitive is this listing in the market right now?"
 *     Higher = stronger seller's position, fresher listing, less distress.
 *
 *   Acquisition Opportunity Score (0–100)
 *     "How attractive is this as an acquisition target for an investor?"
 *     Higher = more motivated seller, more distress signals, better deal potential.
 *
 * Formula versioning:
 *   FORMULA_VERSION is bumped whenever weights or logic change.
 *   Old breakdown records stored in scoring_breakdown remain interpretable
 *   because each record carries the version it was computed with.
 *
 * No AI. No external calls. Pure functions over the data we already have.
 */

import type { ScoreBreakdown, OpportunitySignal } from './types'

export const FORMULA_VERSION = 'v1.0'

// ── Market Position Score ─────────────────────────────────────────────────────
// Inputs: DOM, price reductions, status, back-on-market flag.
// Purpose: helps the agent understand where the property stands competitively.

interface MarketPositionInputs {
  daysOnMarket:        number | null
  priceReductionCount: number | null
  status:              string | null
  backOnMarket:        boolean
  listingCycle:        number
}

export function computeMarketPositionScore(
  inputs: MarketPositionInputs,
): { score: number; breakdown: ScoreBreakdown } {
  const components: Record<string, number> = {}
  let total = 50   // base

  // ── DOM component ──────────────────────────────────────────────────────────
  const dom = inputs.daysOnMarket
  if (dom != null && (inputs.status === 'Active' || inputs.status === 'Pending')) {
    const domAdj =
      dom <= 14  ? +25 :
      dom <= 30  ? +15 :
      dom <= 60  ? +5  :
      dom <= 90  ? -10 :
      dom <= 120 ? -20 :
                   -30
    components['dom'] = domAdj
    total += domAdj
  } else {
    components['dom'] = 0
  }

  // ── Price reduction component ──────────────────────────────────────────────
  const reductions = inputs.priceReductionCount ?? 0
  const reductionAdj =
    reductions === 0 ? +10 :
    reductions === 1 ? -5  :
    reductions === 2 ? -15 :
                       -25
  components['price_reductions'] = reductionAdj
  total += reductionAdj

  // ── Status component ───────────────────────────────────────────────────────
  const statusAdj =
    inputs.status === 'Active'    ? 0   :
    inputs.status === 'Pending'   ? +20 :
    inputs.status === 'Expired'   ? -25 :
    inputs.status === 'Withdrawn' ? -20 :
                                    0
  components['status'] = statusAdj
  total += statusAdj

  // ── Back-on-market penalty ─────────────────────────────────────────────────
  if (inputs.backOnMarket) {
    components['back_on_market'] = -10
    total -= 10
  } else {
    components['back_on_market'] = 0
  }

  // ── Multiple-cycle penalty (relisted more than once) ───────────────────────
  if (inputs.listingCycle > 2) {
    const cyclePenalty = Math.min((inputs.listingCycle - 2) * 5, 15)
    components['listing_cycle'] = -cyclePenalty
    total -= cyclePenalty
  } else {
    components['listing_cycle'] = 0
  }

  const clampedFrom = total
  const score       = Math.max(0, Math.min(100, Math.round(total)))

  const breakdown: ScoreBreakdown = {
    version:     FORMULA_VERSION,
    scoredAt:    new Date().toISOString(),
    inputs: {
      daysOnMarket:        inputs.daysOnMarket,
      priceReductionCount: inputs.priceReductionCount,
      status:              inputs.status,
      backOnMarket:        inputs.backOnMarket,
      listingCycle:        inputs.listingCycle,
      activeSignalTypes:   [],
    },
    components,
    clampedFrom,
    total: score,
  }

  return { score, breakdown }
}

// ── Acquisition Opportunity Score ─────────────────────────────────────────────
// Inputs: opportunity signals (from all sources), DOM, price reductions, status.
// Purpose: helps the investor prioritize which property to pursue.

interface AcquisitionOpportunityInputs {
  daysOnMarket:        number | null
  priceReductionCount: number | null
  status:              string | null
  activeSignals:       OpportunitySignal[]
}

// Signal weights: how much each signal type contributes to acquisition opportunity.
// Weights are ordered from highest to lowest value.
const SIGNAL_WEIGHTS: Partial<Record<string, number>> = {
  pre_foreclosure:           25,
  probate:                   20,
  tax_deed:                  20,
  below_market:              12,
  expired_listing:           12,
  lis_pendens:               15,
  high_equity:               15,
  surplus_funds:             15,
  absentee_owner:            10,
  high_dom:                  10,
  free_and_clear:            10,
  back_on_market:            8,
  mls_price_reduced:         8,
  multiple_price_reductions: 5,
  investor_owned:            5,
  non_owner_occupied:        5,
  vacant:                    5,
  no_hoa:                    3,
}

const MAX_SIGNAL_CONTRIBUTION = 55   // cap prevents one very strong signal from dominating

export function computeAcquisitionOpportunityScore(
  inputs: AcquisitionOpportunityInputs,
): { score: number; breakdown: ScoreBreakdown } {
  const components: Record<string, number> = {}
  let total = 15   // base

  // ── Signal contributions ───────────────────────────────────────────────────
  const activeSignalTypes = inputs.activeSignals
    .filter(s => s.isActive)
    .map(s => s.signalType)

  let signalContribution = 0
  for (const signal of inputs.activeSignals) {
    if (!signal.isActive) continue
    const weight = SIGNAL_WEIGHTS[signal.signalType] ?? 0
    if (weight > 0) {
      signalContribution += weight
      components[`signal_${signal.signalType}`] = weight
    }
  }
  // Cap signal total
  const cappedSignals = Math.min(signalContribution, MAX_SIGNAL_CONTRIBUTION)
  if (signalContribution !== cappedSignals) {
    components['signal_cap'] = cappedSignals - signalContribution  // negative to show what was removed
  }
  total += cappedSignals

  // ── DOM bonus (motivated seller evidence) ──────────────────────────────────
  const dom = inputs.daysOnMarket
  if (dom != null && inputs.status === 'Active') {
    const domBonus =
      dom >= 90 ? +15 :
      dom >= 60 ? +8  :
      dom >= 30 ? +3  :
                  0
    components['dom_bonus'] = domBonus
    total += domBonus
  } else {
    components['dom_bonus'] = 0
  }

  // ── Price reduction bonus (seller concessions) ─────────────────────────────
  const reductions = inputs.priceReductionCount ?? 0
  const reductionBonus =
    reductions >= 2 ? +5 :
    reductions >= 1 ? +3 :
                      0
  components['reduction_bonus'] = reductionBonus
  total += reductionBonus

  const clampedFrom = total
  const score       = Math.max(0, Math.min(100, Math.round(total)))

  const breakdown: ScoreBreakdown = {
    version:     FORMULA_VERSION,
    scoredAt:    new Date().toISOString(),
    inputs: {
      daysOnMarket:        inputs.daysOnMarket,
      priceReductionCount: inputs.priceReductionCount,
      status:              inputs.status,
      backOnMarket:        activeSignalTypes.includes('back_on_market'),
      listingCycle:        1,
      activeSignalTypes,
    },
    components,
    clampedFrom,
    total: score,
  }

  return { score, breakdown }
}

// ── Merged breakdown ──────────────────────────────────────────────────────────
// The listing_intelligence row stores ONE scoring_breakdown that contains both
// scores, sharing the inputs section.

export interface CombinedScoringResult {
  marketPositionScore:         number
  acquisitionOpportunityScore: number
  scoringBreakdown: ScoreBreakdown
}

export function computeScores(
  marketInputs:     MarketPositionInputs,
  acquisitionInputs: AcquisitionOpportunityInputs,
): CombinedScoringResult {
  const mp  = computeMarketPositionScore(marketInputs)
  const ao  = computeAcquisitionOpportunityScore(acquisitionInputs)

  // Merge breakdowns into one record — both score histories share inputs
  const merged: ScoreBreakdown = {
    version:  FORMULA_VERSION,
    scoredAt: mp.breakdown.scoredAt,
    inputs:   {
      ...mp.breakdown.inputs,
      activeSignalTypes: ao.breakdown.inputs.activeSignalTypes,
    },
    components: {
      ...prefixKeys(mp.breakdown.components, 'mp_'),
      ...prefixKeys(ao.breakdown.components, 'ao_'),
    },
    clampedFrom:           mp.breakdown.clampedFrom,
    total:                 mp.breakdown.total,
    acquisitionScoreScope: 'mls_only' as const,  // upgrade to 'full' when county PA + other signals wired
  }

  return {
    marketPositionScore:         mp.score,
    acquisitionOpportunityScore: ao.score,
    scoringBreakdown:            merged,
  }
}

function prefixKeys(obj: Record<string, number>, prefix: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(obj)) out[`${prefix}${k}`] = v
  return out
}
