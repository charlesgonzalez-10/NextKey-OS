/**
 * Deal Scrubber — configuration and pure helpers
 *
 * The scrubber pulls new Broward pre-foreclosures every other Saturday,
 * keeps only the ones that fit Charles's buy box, checks they are still
 * active, attaches comps and an equity estimate, and stores the batch for
 * the Agent HQ "Deal Scrubber" agent to review.
 *
 * Everything in this file is pure (no I/O) so it can be unit-tested.
 */

export interface ScrubConfig {
  county:          'broward'
  /** City names as REAPI returns them (upper/lower case is ignored). */
  cities:          string[]
  /** First filing date ever pulled (ISO). Later runs start where the last one ended. */
  startDate:       string
  /** Skip anything worth more than this (estimated market value, USD). */
  maxValue:        number
  /** Multifamily must be under 10 units. */
  maxUnits:        number
  /** Minimum equity for a well-kept property to stay in (fraction, 0.2 = 20%). */
  minEquity:       number
  /** Hard cap on properties that get the paid detail steps in one run. */
  maxCandidates:   number
  /** Hard cap on estimated vendor spend for the pull step (cents). */
  maxPullCents:    number
  /** Hard cap on comps lookups in one run. */
  maxCompsCalls:   number
}

export const DEFAULT_SCRUB_CONFIG: ScrubConfig = {
  county:        'broward',
  cities:        ['Hollywood', 'Fort Lauderdale', 'Plantation', 'Lauderhill', 'Sunrise', 'Davie'],
  startDate:     '2026-09-01',
  maxValue:      800_000,
  maxUnits:      9,
  minEquity:     0.2,
  maxCandidates: 60,
  maxPullCents:  300,
  maxCompsCalls: 40,
}

/** Normalise a city name: "FT LAUDERDALE" → "fort lauderdale". */
export function normCity(city: string | null | undefined): string {
  return (city ?? '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/^ft\s+/, 'fort ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type PropertyKind = 'single_family' | 'multifamily' | 'other'

/** Classify a property type string from REAPI / county data. */
export function propertyKind(type: string | null | undefined, units: number | null | undefined): PropertyKind {
  const t = (type ?? '').toLowerCase()
  if (/condo|co-?op|mobile|manufactured|land|vacant|commercial|industrial|timeshare/.test(t)) return 'other'
  if (/multi|duplex|triplex|quad|mfr|2-4|apartment/.test(t) || (units != null && units >= 2)) return 'multifamily'
  if (/single|sfr|residential|house|townhouse|townhome/.test(t) || units === 1) return 'single_family'
  return 'other'
}

export interface CandidateInput {
  city:               string | null
  property_type:      string | null
  units:              number | null
  market_value:       number | null
  is_pre_foreclosure: boolean | null
}

export type FilterVerdict =
  | { keep: true }
  | { keep: false; reason: 'not_pre_foreclosure' | 'outside_area' | 'property_type' | 'too_many_units' | 'over_value' }

/** Apply the buy box. Unknown value is kept (the agent checks it later). */
export function fitsBuyBox(p: CandidateInput, cfg: ScrubConfig = DEFAULT_SCRUB_CONFIG): FilterVerdict {
  if (!p.is_pre_foreclosure) return { keep: false, reason: 'not_pre_foreclosure' }
  const allowed = new Set(cfg.cities.map(normCity))
  if (!allowed.has(normCity(p.city))) return { keep: false, reason: 'outside_area' }
  const kind = propertyKind(p.property_type, p.units)
  if (kind === 'other') return { keep: false, reason: 'property_type' }
  if (kind === 'multifamily' && p.units != null && p.units > cfg.maxUnits) return { keep: false, reason: 'too_many_units' }
  if (p.market_value != null && p.market_value > cfg.maxValue) return { keep: false, reason: 'over_value' }
  return { keep: true }
}

/** The filing-date window for this run: day after the last window end, through today. */
export function scrubWindow(lastWindowTo: string | null, today: Date, cfg: ScrubConfig = DEFAULT_SCRUB_CONFIG): { from: string; to: string } {
  const to = today.toISOString().slice(0, 10)
  if (!lastWindowTo) return { from: cfg.startDate, to }
  const next = new Date(`${lastWindowTo}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const from = next.toISOString().slice(0, 10)
  return { from: from > to ? to : from, to }
}

/** Every other Saturday, counted from an anchor Saturday (ISO date). */
export function isScrubSaturday(now: Date, anchor = '2026-10-17'): boolean {
  if (now.getUTCDay() !== 6) return false
  const a = Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7) - 1, +anchor.slice(8, 10))
  const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const weeks = Math.round((d - a) / (7 * 86_400_000))
  return weeks >= 0 && weeks % 2 === 0
}

export interface ActiveCheck { status: 'active' | 'closed' | 'unknown' }

/** Decide whether the foreclosure is still open from REAPI foreclosure history. */
export function foreclosureStatus(history: Array<{ active?: boolean }> | null | undefined): ActiveCheck['status'] {
  if (!history || history.length === 0) return 'unknown'
  if (history.some(h => h.active === true)) return 'active'
  if (history.every(h => h.active === false)) return 'closed'
  return 'unknown'
}

/** Estimated value from comps: median sold $/sqft × living area, else AVM, else REAPI value. */
export function estimateValue(input: {
  soldPricesPerSqft: number[]
  livingArea:        number | null
  avm:               number | null
  reapiValue:        number | null
}): { value: number | null; basis: 'comps' | 'avm' | 'reapi' | 'none' } {
  const pps = input.soldPricesPerSqft.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (pps.length >= 3 && input.livingArea && input.livingArea > 0) {
    const mid = Math.floor(pps.length / 2)
    const median = pps.length % 2 ? pps[mid] : (pps[mid - 1] + pps[mid]) / 2
    return { value: Math.round(median * input.livingArea), basis: 'comps' }
  }
  if (input.avm && input.avm > 0) return { value: Math.round(input.avm), basis: 'avm' }
  if (input.reapiValue && input.reapiValue > 0) return { value: Math.round(input.reapiValue), basis: 'reapi' }
  return { value: null, basis: 'none' }
}

/** Equity as a fraction of value. Null when either side is unknown. */
export function equityFraction(value: number | null, debt: number | null): number | null {
  if (value == null || value <= 0 || debt == null) return null
  return Math.round(((value - debt) / value) * 1000) / 1000
}
