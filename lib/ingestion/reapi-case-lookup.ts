/**
 * REAPI Case Number Lookup — Gateway-enforced
 *
 * Routes every /PropertyDetail call through ProviderGateway.
 * Pool:    background_operations (default) — no customer credits.
 * Cost:    5¢ per call (property_detail_lookup feature).
 * Idempotency: request_id = case-{md5(apn+fips)}-{minute} — retries within
 *              the same minute reuse the same ID (DB UNIQUE constraint blocks
 *              double-charging on concurrent retry).
 * Fail-closed: if pricing unavailable or budget exhausted → budget_paused, not error.
 * Skip-if-known: if existingCaseNumber is supplied → skipped immediately (0 cost).
 */

import crypto from 'crypto'
import type { BillingContext } from '@/lib/billing/gatewayContext'
import { providerGateway } from '@/lib/billing/providerGateway'
import { pricingEngine } from '@/lib/billing/pricingEngine'
import { BACKGROUND_CONTEXT } from '@/lib/billing/gatewayContext'

const REAPI_BASE = 'https://api.realestateapi.com/v2'
export const CASE_LOOKUP_FEATURE_KEY = 'property_detail_lookup'

const COUNTY_FIPS: Record<string, string> = {
  'broward':    '12011',
  'miami-dade': '12086',
  'palm-beach': '12099',
}

export interface ForeclosureInfoEntry {
  active?:         boolean
  caseNumber?:     string | null
  noticeType?:     string | null
  recordingDate?:  string | null
  documentType?:   string | null
  lenderName?:     string | null
  judgmentAmount?: string | null
  defaultAmount?:  string | null
  openingBid?:     number | null
  foreclosureId?:  number
  seqNo?:          number
}

function pickBestCaseNumber(entries: ForeclosureInfoEntry[]): string | null {
  const withCase = entries.filter(e => e.caseNumber && e.caseNumber.trim())
  if (withCase.length === 0) return null

  withCase.sort((a, b) => {
    const da = a.recordingDate ? new Date(a.recordingDate).getTime() : 0
    const db = b.recordingDate ? new Date(b.recordingDate).getTime() : 0
    return db - da
  })

  return withCase[0].caseNumber!.trim()
}

export type CaseLookupOutcome =
  | { outcome: 'found';            case_number: string; foreclosure_history: ForeclosureInfoEntry[]; request_id: string }
  | { outcome: 'not_found';        foreclosure_history: ForeclosureInfoEntry[]; request_id: string }
  | { outcome: 'budget_paused';    error_code: string; safe_message: string }
  | { outcome: 'provider_failed';  error: string }
  | { outcome: 'feature_disabled'; error_code: string }
  | { outcome: 'skipped';          reason: string }

export async function lookupCaseNumber(params: {
  apn:                 string
  county:              string
  existingCaseNumber?: string | null
  billing?:            BillingContext
}): Promise<CaseLookupOutcome> {
  // Skip when we already have a case number — 0 cost
  if (params.existingCaseNumber) {
    return { outcome: 'skipped', reason: 'already_known' }
  }

  const billing = params.billing ?? BACKGROUND_CONTEXT

  const key = process.env.REAPI_KEY
  if (!key) {
    return { outcome: 'feature_disabled', error_code: 'provider_not_configured' }
  }

  const fips = COUNTY_FIPS[params.county.toLowerCase()]
  if (!fips) {
    return { outcome: 'skipped', reason: 'unsupported_county' }
  }

  // Pricing — fail closed if unknown/disabled
  const pricing = await pricingEngine.getActivePricing(CASE_LOOKUP_FEATURE_KEY)
  if (!pricing) {
    return { outcome: 'feature_disabled', error_code: 'feature_not_configured' }
  }
  if (!pricing.is_enabled) {
    return { outcome: 'feature_disabled', error_code: 'feature_disabled' }
  }
  if (pricing.requires_confirmed_cost && pricing.expected_vendor_cost_cents === 0) {
    return { outcome: 'feature_disabled', error_code: 'unknown_vendor_cost' }
  }

  // Idempotency key — minute-granular to absorb same-minute retries
  const hash = crypto.createHash('md5').update(`${params.apn}:${fips}`).digest('hex').slice(0, 8)
  const request_id = `case-${hash}-${Math.floor(Date.now() / 60_000)}`
  const start = Date.now()

  const auth = await providerGateway.authorize({
    request_id,
    account_id:           billing.account_id,
    feature_key:          CASE_LOOKUP_FEATURE_KEY,
    provider_key:         'reapi',
    pool_key:             billing.pool_key,
    estimated_cost_cents: pricing.expected_vendor_cost_cents,
    credit_cost:          0,   // case lookup never charges customer credits
    is_zero_cost_feature: false,
  })

  if (!auth.success) {
    return {
      outcome:      'budget_paused',
      error_code:   auth.error_code    ?? 'authorization_failed',
      safe_message: auth.error_message ?? 'Budget unavailable for case lookup.',
    }
  }

  try {
    const res = await fetch(`${REAPI_BASE}/PropertyDetail`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body:    JSON.stringify({ apn: params.apn, fips }),
      signal:  AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`REAPI HTTP ${res.status}: ${text.slice(0, 100)}`)
    }

    const data = await res.json()
    const detail = Array.isArray(data.data) ? data.data[0] : data.data

    const foreclosureInfo: ForeclosureInfoEntry[] = detail?.foreclosureInfo ?? []
    const case_number = pickBestCaseNumber(foreclosureInfo)

    providerGateway.finalize({
      request_id,
      actual_cost_cents: pricing.expected_vendor_cost_cents,
      success:           true,
      duration_ms:       Date.now() - start,
    }).catch(e => console.error('[CaseLookup] finalize error:', e))

    if (case_number) {
      console.log(`[CaseLookup] Found ${case_number} for ${params.apn}`)
      return { outcome: 'found', case_number, foreclosure_history: foreclosureInfo, request_id }
    }

    console.log(`[CaseLookup] No case number for ${params.apn} (${foreclosureInfo.length} entries)`)
    return { outcome: 'not_found', foreclosure_history: foreclosureInfo, request_id }

  } catch (err) {
    providerGateway.finalize({
      request_id,
      actual_cost_cents: 0,
      success:           false,
      error_code:        'provider_error',
      duration_ms:       Date.now() - start,
    }).catch(() => {})

    console.error(`[CaseLookup] Provider error for ${params.apn}:`, err)
    return {
      outcome: 'provider_failed',
      error:   err instanceof Error ? err.message : String(err),
    }
  }
}
