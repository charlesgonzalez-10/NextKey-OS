/**
 * MLS Comparable Fetcher — REAPI adapter (Sprint 3)
 *
 * Fetches comparable properties from REAPI for a subject property.
 * This is NOT a DsoeProviderDef — comps are a search operation returning
 * multiple results, which doesn't fit the DSOE router's one-property model.
 * Called directly by lib/graph/comparables.ts.
 *
 * Cost controls:
 *   - Photos are never fetched (no photo param in request)
 *   - Radius and count are bounded to prevent oversized responses
 *   - Cache check is the caller's responsibility (comparables.ts owns TTL)
 *
 * Endpoint: POST /v2/PropertyComps
 * Docs: https://api.realestateapi.com/docs — confirm params before changing
 *
 * If REAPI changes their comps endpoint, update REAPI_COMPS_PATH below
 * and the REAPICompRaw interface. NormalizedComp shape must stay stable.
 */

import { randomUUID } from 'crypto'
import type { CompStatus } from '../types'
import { providerGateway } from '@/lib/billing/providerGateway'
import { pricingEngine } from '@/lib/billing/pricingEngine'
import { BACKGROUND_CONTEXT } from '@/lib/billing/gatewayContext'

const REAPI_BASE       = 'https://api.realestateapi.com/v2'
const REAPI_COMPS_PATH = '/PropertyComps'
const COMPS_FEATURE_KEY = 'comps_refresh'

// ── Raw REAPI comp shape ──────────────────────────────────────────────────────
// Only fields we actually use — extras stay in rawSource.

interface REAPICompRaw {
  mlsId?:             string
  mlsNumber?:         string
  mlsStatus?:         string
  mlsActive?:         boolean
  mlsPending?:        boolean
  mlsSold?:           boolean
  mlsListingPrice?:   number
  closePrice?:        number
  originalListingPrice?: number
  listingDate?:       string
  closingDate?:       string
  daysOnMarket?:      number
  address?:           { address?: string; street?: string; city?: string; state?: string; zip?: string }
  city?:              string
  state?:             string
  zip?:               string
  bedrooms?:          number
  bathrooms?:         number
  squareFeet?:        number
  lotSquareFeet?:     number
  yearBuilt?:         number
  propertyType?:      string
  propertyUse?:       string
  pricePerSquareFoot?: number
  distanceMiles?:     number
  subdivision?:       string
  [key: string]: unknown
}

// ── Normalized comp shape ─────────────────────────────────────────────────────

export interface NormalizedComp {
  provenanceId:   string        // MLS ID or fallback fingerprint — for deduplication
  mlsNumber:      string | null
  compStatus:     CompStatus
  address: {
    street:       string | null
    city:         string | null
    state:        string | null
    zip:          string | null
  }
  listPrice:      number | null
  closePrice:     number | null
  originalListPrice: number | null
  sqft:           number | null
  beds:           number | null
  baths:          number | null
  yearBuilt:      number | null
  lotSqft:        number | null
  daysOnMarket:   number | null
  pricePerSqft:   number | null
  distanceMiles:  number | null
  listDate:       string | null
  closeDate:      string | null
  subdivision:    string | null
  propertyType:   string | null
  rawSource:      Record<string, unknown>
  fetchedAt:      string
}

export interface CompFetchResult {
  comps:       NormalizedComp[]
  success:     boolean
  durationMs:  number
  error?:      string
  /** Estimated cost of this call in cents (from REAPI plan metadata) */
  costCents:   number
}

// ── Status normalization ──────────────────────────────────────────────────────

function normalizeCompStatus(raw: REAPICompRaw): CompStatus {
  const s = (raw.mlsStatus ?? '').toLowerCase()
  if (s.includes('active') && !s.includes('contract')) return 'active'
  if (s.includes('pending') || s.includes('contract')) return 'pending'
  if (s.includes('closed') || s.includes('sold'))      return 'sold'
  if (s.includes('expired'))                            return 'expired'
  if (raw.mlsActive)   return 'active'
  if (raw.mlsPending)  return 'pending'
  if (raw.mlsSold)     return 'sold'
  return 'sold'  // comps default to sold if unknown — most comps fetches are for CMA
}

// ── Raw → NormalizedComp ──────────────────────────────────────────────────────

function normalizeComp(raw: REAPICompRaw, fetchedAt: string): NormalizedComp {
  const sqft      = raw.squareFeet ?? null
  const listPrice = raw.mlsListingPrice ?? null
  const closePrice = raw.closePrice ?? null

  const pricePerSqft = raw.pricePerSquareFoot
    ?? (sqft && (closePrice ?? listPrice)
      ? parseFloat(((closePrice ?? listPrice ?? 0) / sqft).toFixed(0))
      : null)

  const street = raw.address?.address ?? raw.address?.street ?? null
  const city   = raw.address?.city ?? raw.city ?? null
  const state  = raw.address?.state ?? raw.state ?? null
  const zip    = raw.address?.zip ?? raw.zip ?? null

  // Deterministic provenance ID: prefer MLS number, fall back to address fingerprint
  const mlsNumber   = raw.mlsId ?? raw.mlsNumber ?? null
  const provenanceId = mlsNumber
    ?? [street, city, zip, raw.listingDate].filter(Boolean).join('|')

  return {
    provenanceId,
    mlsNumber,
    compStatus:        normalizeCompStatus(raw),
    address:           { street, city, state, zip },
    listPrice,
    closePrice,
    originalListPrice: raw.originalListingPrice ?? null,
    sqft,
    beds:              raw.bedrooms ?? null,
    baths:             raw.bathrooms ?? null,
    yearBuilt:         raw.yearBuilt ?? null,
    lotSqft:           raw.lotSquareFeet ?? null,
    daysOnMarket:      raw.daysOnMarket ?? null,
    pricePerSqft,
    distanceMiles:     raw.distanceMiles ?? null,
    listDate:          raw.listingDate ?? null,
    closeDate:         raw.closingDate ?? null,
    subdivision:       raw.subdivision ?? null,
    propertyType:      raw.propertyUse ?? raw.propertyType ?? null,
    rawSource:         raw as Record<string, unknown>,
    fetchedAt,
  }
}

// ── Main fetch function ───────────────────────────────────────────────────────

export interface CompFetchQuery {
  /** Subject property address (required if no folio) */
  address?: string | null
  city?:    string | null
  state?:   string | null
  zip?:     string | null
  /** County APN / folio (preferred over address) */
  folio?:   string | null
  /** Property type for filtering similar comps */
  propertyType?: string | null
  /** Search radius in miles (default 0.5, capped at 2.0) */
  radiusMiles?:  number
  /** Max comps to return (default 10, capped at 25) */
  maxComps?:     number
  /** Filter by status: 'sold' | 'active' | 'pending' — omit for all */
  status?:       'sold' | 'active' | 'pending'
  /** Sold comps only: max days back to look (default 180) */
  soldWithinDays?: number
}

/**
 * Fetch comparable properties from REAPI.
 *
 * Does NOT write to any table — caller owns persistence.
 * Does NOT fetch photos — cost control.
 * Returns an empty comps array (not an error) when REAPI has no results.
 */
export async function fetchCompsFromReapi(query: CompFetchQuery): Promise<CompFetchResult> {
  const key = process.env.REAPI_KEY

  if (!key) {
    return { comps: [], success: false, durationMs: 0, costCents: 0, error: 'REAPI_KEY not configured' }
  }

  if (!query.address && !query.folio) {
    return { comps: [], success: false, durationMs: 0, costCents: 0, error: 'address or folio required' }
  }

  // Gateway: authorize via background pool. Comps are platform-absorbed enrichment;
  // this records cost in the background_operations pool so NextKey can measure REAPI spend.
  const request_id = randomUUID()
  const pricing    = await pricingEngine.getActivePricing(COMPS_FEATURE_KEY)
  if (!pricing?.is_enabled) {
    return { comps: [], success: false, durationMs: 0, costCents: 0, error: 'Comps feature not enabled' }
  }

  const auth = await providerGateway.authorize({
    request_id,
    account_id:           BACKGROUND_CONTEXT.account_id,
    feature_key:          COMPS_FEATURE_KEY,
    provider_key:         'reapi',
    pool_key:             BACKGROUND_CONTEXT.pool_key,
    estimated_cost_cents: pricing.expected_vendor_cost_cents,
    credit_cost:          0,
    is_zero_cost_feature: false,
  })

  if (!auth.success) {
    return { comps: [], success: false, durationMs: 0, costCents: 0, error: `Budget blocked: ${auth.error_code}` }
  }

  const radius   = Math.min(query.radiusMiles ?? 0.5, 2.0)
  const maxComps = Math.min(query.maxComps ?? 10, 25)

  const body: Record<string, unknown> = {
    size:   maxComps,
    radius,
    // Never request photos — comps are scored on price/sqft/location, not presentation
    includePhotos: false,
  }

  if (query.folio) {
    body.apn = query.folio.replace(/\D/g, '')
  } else {
    body.address = query.address
    if (query.city)  body.city  = query.city
    if (query.state) body.state = query.state
    if (query.zip)   body.zip   = query.zip
  }

  if (query.propertyType) body.propertyType = query.propertyType

  if (query.status === 'sold') {
    body.mlsSold        = true
    body.soldWithinDays = query.soldWithinDays ?? 180
  } else if (query.status === 'active') {
    body.mlsListingActive = true
  } else if (query.status === 'pending') {
    body.mlsPending = true
  }

  const start = Date.now()

  try {
    const res = await fetch(`${REAPI_BASE}${REAPI_COMPS_PATH}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    })

    const durationMs = Date.now() - start

    if (!res.ok) {
      providerGateway.finalize({ request_id, actual_cost_cents: 0, success: false, error_code: `http_${res.status}`, duration_ms: durationMs }).catch(() => {})
      return {
        comps:      [],
        success:    false,
        durationMs,
        costCents:  0,
        error:      `REAPI HTTP ${res.status}`,
      }
    }

    const json = await res.json()
    const fetchedAt  = new Date().toISOString()
    const rawResults: REAPICompRaw[] = Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.comps)
        ? json.comps
        : []

    const comps = rawResults.map(r => normalizeComp(r, fetchedAt))
    const costCents = pricing.expected_vendor_cost_cents

    providerGateway.finalize({ request_id, actual_cost_cents: costCents, success: true, duration_ms: durationMs }).catch(() => {})

    return { comps, success: true, durationMs, costCents }
  } catch (err) {
    const durationMs = Date.now() - start
    providerGateway.finalize({ request_id, actual_cost_cents: 0, success: false, error_code: 'timeout_or_error', duration_ms: durationMs }).catch(() => {})
    return {
      comps:      [],
      success:    false,
      durationMs,
      costCents:  0,
      error:      err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
