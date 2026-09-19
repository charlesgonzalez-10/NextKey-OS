/**
 * REAPI Live Property Search
 *
 * Translates NextKey URL search params → REAPI /v2/PropertySearch body,
 * executes the search (with optional pagination), and normalises the
 * response into the same shape the UI already knows how to render.
 *
 * REAPI supported params (validated):
 *   county, city, zip, address, apn, radius (+ latitude/longitude),
 *   polygon [{lat, lon}], pre_foreclosure, foreclosure, auction,
 *   pre_foreclosure_date_min/max, foreclosure_date_min/max, auction_date_min/max,
 *   beds_min/max, baths_min/max, year_built_min/max, value_min/max,
 *   equity_percent_min/max, absentee_owner, owner_occupied,
 *   size (max 250), resultIndex
 */

import crypto from 'crypto'
import type { BillingContext } from '@/lib/billing/gatewayContext'
import type { AuthorizationResult } from '@/lib/billing/types'
import { providerGateway } from '@/lib/billing/providerGateway'
import { pricingEngine } from '@/lib/billing/pricingEngine'
import { serviceClient } from '@/lib/supabase-service'
import { providerHealthService } from '@/lib/billing/providerHealth'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Normalised property shape (matches what the results UI expects) */
export interface LiveProperty {
  // Identity
  id:                string        // 'REAPI-{propertyId}' — temp key until saved
  reapi_id:          string
  folio_number:      string | null
  case_number:       null          // Court case # unknown from REAPI — comes from county clerk
  source:            'reapi'
  data_source:       string        // 'Broward REAPI' etc.

  // Location
  property_address:  string | null
  city:              string | null
  zip:               string | null
  state:             string
  county:            string        // 'broward' | 'miami-dade' | 'palm-beach'
  latitude:          number | null
  longitude:         number | null
  subdivision_name:  string | null

  // Owner
  owner_name:        string | null
  mortgagor:         string | null
  entity_type:       string | null
  homestead:         boolean | null
  absentee_owner:    boolean | null

  // Property details
  beds:              number | null
  baths:             number | null
  living_area:       number | null
  lot_size:          number | null
  year_built:        number | null
  property_type:     string | null

  // Financials
  market_value:      number | null
  assessed_value:    number | null
  known_debt:        number | null
  equity_percentage: number | null
  equity_dollar_amount: number | null
  equity_tier:       'High' | 'Medium' | 'Low' | 'None'
  free_clear:        boolean
  high_equity:       boolean
  suggested_rent:    number | null

  // Distress flags
  is_pre_foreclosure: boolean
  is_foreclosure:     boolean
  is_auction:         boolean
  is_probate:         boolean
  is_tax_deed:        boolean
  is_divorce:         boolean
  multiple_liens:     boolean
  foreclosure_type:   string | null

  // Filing info
  file_date:         string | null
  plaintiff:         string | null
  lender_name:       string | null

  // MLS
  mls_status:        string | null
  mls_listing_price: number | null
  mls_active:        boolean

  // Lead status (null = not saved yet)
  lead_id:           null
  pipeline_stage:    null
  starred:           false
  lead_score:        null
  ai_score:          null
  is_lead:           false

  // Phones (not from REAPI — filled after save + enrichment)
  phone_1: null; phone_2: null; phone_3: null

  // Raw REAPI response
  _raw: Record<string, unknown>
}

interface REAPIAddress {
  address?: string; street?: string; city?: string
  state?: string; zip?: string; county?: string; fips?: string
}

interface REAPIProperty {
  propertyId?:          string | number
  apn?:                 string
  address?:             REAPIAddress
  mailAddress?:         REAPIAddress
  owner1FirstName?:     string; owner1LastName?: string
  owner2FirstName?:     string; owner2LastName?: string
  companyName?:         string
  bedrooms?:            number | null
  bathrooms?:           number | null
  squareFeet?:          number | null
  lotSquareFeet?:       number | null
  yearBuilt?:           number | null
  assessedValue?:       number | null
  estimatedValue?:      number | null
  openMortgageBalance?: number | null
  equityPercent?:       number | null
  estimatedEquity?:     number | null
  lenderName?:          string | null
  propertyType?:        string | null
  propertyUse?:         string | null
  noticeType?:          string | null
  preForeclosure?:      boolean
  foreclosure?:         boolean
  auction?:             boolean
  auctionDate?:         string | null
  lastUpdateDate?:      string | null
  recordingDate?:       string | null
  latitude?:            number | null
  longitude?:           number | null
  suggestedRent?:       string | number | null
  ownerOccupied?:       boolean
  absenteeOwner?:       boolean
  outOfStateAbsenteeOwner?: boolean
  freeClear?:           boolean
  highEquity?:          boolean
  vacant?:              boolean
  neighborhood?:        { name?: string }
  mlsStatus?:           string | null
  mlsListingPrice?:     number | null
  mlsActive?:           boolean
}

interface REAPIResponse {
  statusCode?:   number
  statusMessage?: string
  message?:      string
  data?:         REAPIProperty[]
  resultCount?:  number
  resultIndex?:  number
  recordCount?:  number
}

// ─── County helpers ───────────────────────────────────────────────────────────

const COUNTY_FROM_REAPI: Record<string, string> = {
  'broward county':     'broward',
  'miami-dade county':  'miami-dade',
  'miami dade county':  'miami-dade',
  'palm beach county':  'palm-beach',
}

function normaliseCounty(raw: string | undefined): string {
  if (!raw) return ''
  return COUNTY_FROM_REAPI[raw.toLowerCase()] ?? raw.toLowerCase().replace(' county', '').trim()
}

const DATA_SOURCE: Record<string, string> = {
  broward:      'Broward REAPI',
  'miami-dade': 'Miami-Dade REAPI',
  'palm-beach': 'PBC REAPI',
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function ownerName(p: REAPIProperty): string | null {
  const first  = [p.owner1FirstName, p.owner1LastName].filter(Boolean).join(' ').trim()
  const second = [p.owner2FirstName, p.owner2LastName].filter(Boolean).join(' ').trim()
  if (first && second) return `${first} & ${second}`
  return first || p.companyName || null
}

function equityTier(pct: number | null | undefined): 'High' | 'Medium' | 'Low' | 'None' {
  if (pct == null || pct <= 0) return 'None'
  if (pct >= 50) return 'High'
  if (pct >= 20) return 'Medium'
  return 'Low'
}

function detectEntityType(name: string | null): string | null {
  if (!name) return null
  const up = name.toUpperCase()
  if (/\b(LLC|L\.L\.C)\b/.test(up))                 return 'LLC'
  if (/\b(CORP|INC|LTD|CO\.|COMPANY)\b/.test(up))   return 'Corporation'
  if (/\b(TRUST|TRUSTEE)\b/.test(up))                return 'Trust'
  if (/\b(ESTATE|EST\.)\b/.test(up))                 return 'Estate'
  return 'Individual'
}

function toDateStr(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw.slice(0, 10)
}

function parseSuggestedRent(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

// ─── Normalise one REAPI property → LiveProperty ─────────────────────────────

export function normaliseREAPIProperty(p: REAPIProperty): LiveProperty {
  const id       = `REAPI-${p.propertyId}`
  const addr     = p.address ?? {}
  const county   = normaliseCounty(addr.county)
  const oName    = ownerName(p)
  const equityPct = p.equityPercent ?? null
  const mktVal   = p.estimatedValue ?? null
  const debt     = p.openMortgageBalance ?? null
  const equityAmt = mktVal != null && debt != null
    ? Math.max(0, mktVal - debt) : (p.estimatedEquity ?? null)

  const fileDate = p.auction && p.auctionDate
    ? toDateStr(p.auctionDate)
    : toDateStr(p.lastUpdateDate)

  return {
    id,
    reapi_id:          String(p.propertyId ?? ''),
    folio_number:      p.apn?.trim() ?? null,
    case_number:       null,
    source:            'reapi',
    data_source:       DATA_SOURCE[county] ?? 'REAPI',

    property_address:  addr.address ?? null,
    city:              addr.city ?? null,
    zip:               addr.zip  ?? null,
    state:             'FL',
    county,
    latitude:          p.latitude  ?? null,
    longitude:         p.longitude ?? null,
    subdivision_name:  p.neighborhood?.name ?? null,

    owner_name:        oName,
    mortgagor:         oName,
    entity_type:       detectEntityType(oName),
    homestead:         p.ownerOccupied  ?? null,
    absentee_owner:    p.absenteeOwner  ?? null,

    beds:              p.bedrooms   ?? null,
    baths:             p.bathrooms  ?? null,
    living_area:       p.squareFeet ?? null,
    lot_size:          p.lotSquareFeet ?? null,
    year_built:        p.yearBuilt  ?? null,
    property_type:     p.propertyType ?? p.propertyUse ?? null,

    market_value:         mktVal,
    assessed_value:       p.assessedValue ?? null,
    known_debt:           debt,
    equity_percentage:    equityPct,
    equity_dollar_amount: equityAmt,
    equity_tier:          equityTier(equityPct),
    free_clear:           p.freeClear  ?? false,
    high_equity:          p.highEquity ?? (equityTier(equityPct) === 'High'),
    suggested_rent:       parseSuggestedRent(p.suggestedRent),

    is_pre_foreclosure:   p.preForeclosure ?? false,
    is_foreclosure:       p.foreclosure    ?? false,
    is_auction:           p.auction        ?? false,
    is_probate:           false,
    is_tax_deed:          false,
    is_divorce:           false,
    multiple_liens:       false,
    foreclosure_type:     p.auction ? 'A' : p.foreclosure ? 'F' : p.preForeclosure ? 'P' : null,

    file_date:    fileDate,
    plaintiff:    p.lenderName ?? null,
    lender_name:  p.lenderName ?? null,

    mls_status:        p.mlsStatus        ?? null,
    mls_listing_price: p.mlsListingPrice  ?? null,
    mls_active:        p.mlsActive        ?? false,

    // Not saved yet
    lead_id:        null,
    pipeline_stage: null,
    starred:        false,
    lead_score:     null,
    ai_score:       null,
    is_lead:        false,
    phone_1: null, phone_2: null, phone_3: null,

    _raw: p as Record<string, unknown>,
  }
}

// ─── URL params → REAPI body ──────────────────────────────────────────────────

export interface SearchParams {
  /** Freetext: address, APN, or general query */
  search?:    string
  county?:    string
  city?:      string
  zip?:       string
  /** JSON-stringified zone object from map drawing */
  zone?:      string
  /** Comma-separated lead types: pre_foreclosure,foreclosure,auction */
  lead_types?: string
  /** Equity tier filter: High | Medium | Low */
  equity?:    string
  value_min?: string; value_max?: string
  beds_min?:  string; beds_max?:  string
  baths_min?: string; baths_max?: string
  year_min?:  string; year_max?:  string
  file_from?: string; file_to?:   string
  homestead?:   string  // 'true' | 'false'
  out_of_state?: string // 'true'
  free_clear?:   string // 'true'
}

/** Detects if a string looks like a folio/APN */
function isAPN(s: string): boolean {
  // Broward: 49-41-15-06-0530  |  MD: 30-4108-003-1840  |  all digits
  return /^[\d-]{6,}$/.test(s.trim())
}

/** Build the REAPI request body from NextKey search params */
export function buildREAPIBody(
  params: SearchParams,
  resultIndex = 1,
  size = 250
): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = { state: 'FL', size }
  if (resultIndex > 1) body.resultIndex = resultIndex

  // ── Location ──
  if (params.county) body.county = params.county
    .split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-')
    .replace('Miami-Dade', 'Miami-Dade')
  if (params.city) body.city = params.city
  if (params.zip)  body.zip  = params.zip

  // ── Freetext search ──
  const q = params.search?.trim()
  if (q) {
    if (isAPN(q)) {
      body.apn = q
    } else {
      body.address = q
    }
  }

  // ── Zone / geo ──
  if (params.zone) {
    try {
      const zone = JSON.parse(params.zone)
      if (zone.type === 'polygon' && Array.isArray(zone.path)) {
        body.polygon = zone.path.map((pt: { lat: number; lng: number }) => ({
          lat: pt.lat,
          lon: pt.lng,
        }))
      } else if (zone.type === 'rectangle' && zone.bounds) {
        // Convert rectangle bounds → 4-point polygon
        const { north, south, east, west } = zone.bounds
        body.polygon = [
          { lat: north, lon: west },
          { lat: north, lon: east },
          { lat: south, lon: east },
          { lat: south, lon: west },
        ]
      } else if (zone.type === 'circle' && zone.center && zone.radiusM) {
        body.latitude  = zone.center.lat
        body.longitude = zone.center.lng
        body.radius    = Math.max(1, Math.round(zone.radiusM / 1609.34)) // metres → miles
      }
    } catch { /* ignore invalid zone JSON */ }
  }

  // ── Distress type flags ──
  const leadTypes = (params.lead_types ?? '').split(',').filter(Boolean)
  if (leadTypes.includes('pre_foreclosure') || leadTypes.length === 0) {
    // Default: show pre-foreclosure if no specific type selected
    if (leadTypes.includes('pre_foreclosure')) body.pre_foreclosure = true
  }
  if (leadTypes.includes('foreclosure')) body.foreclosure = true
  if (leadTypes.includes('auction'))     body.auction     = true

  // If nothing was explicitly flagged, default to pre_foreclosure
  if (!body.pre_foreclosure && !body.foreclosure && !body.auction) {
    body.pre_foreclosure = true
  }

  // ── Date range (maps to pre_foreclosure_date when in LP mode) ──
  if (params.file_from) {
    body.pre_foreclosure_date_min = params.file_from
    body.foreclosure_date_min     = params.file_from
  }
  if (params.file_to) {
    body.pre_foreclosure_date_max = params.file_to
    body.foreclosure_date_max     = params.file_to
  }

  // ── Property filters ──
  if (params.beds_min  && Number(params.beds_min)  > 0) body.beds_min  = Number(params.beds_min)
  if (params.beds_max  && Number(params.beds_max)  > 0) body.beds_max  = Number(params.beds_max)
  if (params.baths_min && Number(params.baths_min) > 0) body.baths_min = Number(params.baths_min)
  if (params.baths_max && Number(params.baths_max) > 0) body.baths_max = Number(params.baths_max)
  if (params.year_min  && Number(params.year_min)  >= 1900) body.year_built_min = Number(params.year_min)
  if (params.year_max  && Number(params.year_max)  >= 1900) body.year_built_max = Number(params.year_max)
  if (params.value_min && Number(params.value_min) > 0) body.value_min = Number(params.value_min)
  if (params.value_max && Number(params.value_max) > 0) body.value_max = Number(params.value_max)

  // ── Equity tier ──
  if (params.equity === 'High')   { body.equity_percent_min = 50 }
  if (params.equity === 'Medium') { body.equity_percent_min = 20; body.equity_percent_max = 49 }
  if (params.equity === 'Low')    { body.equity_percent_min = 1;  body.equity_percent_max = 19 }

  // ── Occupancy ──
  if (params.homestead === 'true')    body.owner_occupied  = true
  if (params.out_of_state === 'true') body.absentee_owner  = true

  return body
}

// ─── Cache key ────────────────────────────────────────────────────────────────

/** Stable cache key from search params (excludes page / sort / ui-only params) */
export function buildCacheKey(params: SearchParams): string {
  const stable: Record<string, string | undefined> = {
    search:     params.search,
    county:     params.county,
    city:       params.city,
    zip:        params.zip,
    zone:       params.zone,
    lead_types: params.lead_types,
    equity:     params.equity,
    value_min:  params.value_min,  value_max:  params.value_max,
    beds_min:   params.beds_min,   beds_max:   params.beds_max,
    baths_min:  params.baths_min,  baths_max:  params.baths_max,
    year_min:   params.year_min,   year_max:   params.year_max,
    file_from:  params.file_from,  file_to:    params.file_to,
    homestead:  params.homestead,  out_of_state: params.out_of_state,
  }
  // Remove undefined keys so JSON is stable
  const cleaned = Object.fromEntries(
    Object.entries(stable).filter(([, v]) => v !== undefined && v !== '')
  )
  const json = JSON.stringify(cleaned, Object.keys(cleaned).sort())
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 32)
}

// ─── Internal fetch layer ─────────────────────────────────────────────────────

const REAPI_BASE = 'https://api.realestateapi.com/v2'

interface REAPIPageFetch {
  page:      REAPIProperty[]
  total:     number
  returned:  number
  nextIndex: number
}

// Typed error thrown when REAPI rejects the call for account-level reasons (402).
// Distinct from generic provider errors so the route can show a meaningful message.
export class REAPIProviderAccountError extends Error {
  readonly code: string
  constructor(reapiMessage: string, code = 'REAPI_WALLET_INSUFFICIENT') {
    super(reapiMessage)
    this.name = 'REAPIProviderAccountError'
    this.code = code
  }
}

async function fetchREAPIPage(
  apiKey:    string,
  params:    SearchParams,
  pageIndex: number,
  pageSize:  number,
): Promise<REAPIPageFetch> {
  const body = buildREAPIBody(params, pageIndex, pageSize)
  const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(25_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // REAPI 402 means the REAPI account wallet needs funding — distinct from our billing.
    if (res.status === 402) {
      let reapiMsg = 'REAPI account wallet is insufficient. Add funds at console.realestateapi.com/dashboard/billing'
      try {
        const j = JSON.parse(text)
        if (j.message) reapiMsg = `REAPI: ${j.message}`
      } catch { /* ignore */ }
      throw new REAPIProviderAccountError(reapiMsg)
    }
    throw new Error(`REAPI ${res.status}: ${text.slice(0, 200)}`)
  }
  const data: REAPIResponse = await res.json()
  if (data.statusCode && data.statusCode !== 200) {
    throw new Error(`REAPI error ${data.statusCode}: ${data.message ?? data.statusMessage}`)
  }
  return {
    page:      data.data ?? [],
    total:     data.resultCount ?? 0,
    returned:  data.recordCount ?? (data.data ?? []).length,
    nextIndex: data.resultIndex ?? pageIndex + pageSize,
  }
}

// ─── Gateway search types ─────────────────────────────────────────────────────

export const SEARCH_FEATURE_KEY = 'property_search_criteria'

export interface SearchGatewayConfig {
  /** Max REAPI pages fetched per user action. */
  maxPaidPages:        number
  /** Hard cap on total estimated vendor spend per action (safety guard). */
  maxVendorCostCents:  number
  /** Records requested per REAPI page (max 250). */
  pageSize:            number
  /** Max records returned to the caller regardless of pages fetched. */
  maxTotalRecords:     number
}

export const DEFAULT_SEARCH_CONFIG: SearchGatewayConfig = {
  maxPaidPages:       1,
  maxVendorCostCents: 10,   // 1 page × 5¢ + 5¢ margin
  // 50 records/page: REAPI account wallet supports this size.
  // Increase to 250 once REAPI account is funded at console.realestateapi.com/dashboard/billing.
  pageSize:           50,
  maxTotalRecords:    50,
}

export type SearchOutcomeCode =
  | 'success'
  | 'cache_hit'
  | 'partial_result'
  | 'credit_insufficient'
  | 'account_capacity_limit'
  | 'customer_pool_exhausted'
  | 'global_budget_exhausted'
  | 'provider_disabled'
  | 'feature_disabled'
  | 'authorization_unavailable'
  | 'provider_failed'

export type GatewaySearchOutcome =
  | { outcome: 'success';        properties: LiveProperty[]; total: number; pages_fetched: number; has_more: boolean }
  | { outcome: 'partial_result'; properties: LiveProperty[]; total: number; pages_fetched: number; blocked_at_page: number; error_code: SearchOutcomeCode; safe_message: string; has_more: boolean }
  | { outcome: SearchOutcomeCode; error_code: string; safe_message: string }

function mapAuthToSearchOutcome(auth: AuthorizationResult): SearchOutcomeCode {
  const ec = auth.error_code ?? ''
  if (ec === 'insufficient_credits')                                         return 'credit_insufficient'
  if (ec === 'account_cap_exceeded' || ec === 'no_cost_cap')                 return 'account_capacity_limit'
  if (ec === 'pool_exhausted' || ec === 'pool_not_found')                    return 'customer_pool_exhausted'
  if (ec === 'provider_disabled')                                            return 'provider_disabled'
  if (ec === 'feature_disabled' || ec === 'feature_not_configured'
      || ec === 'unknown_vendor_cost')                                        return 'feature_disabled'
  if (ec === 'protected_pool')                                               return 'account_capacity_limit'
  // Idempotency-key collisions: the request_id already exists in api_budget_reservations.
  // These are NOT billing-gate failures. Both map to authorization_unavailable so the
  // route's 503 branch surfaces safe_message to the client. The per-request UUID in
  // searchSessionId (live/route.ts) prevents these paths in production; this is a
  // defensive backstop only.
  if (ec === 'idempotent_duplicate')   return 'authorization_unavailable'
  if (ec === 'idempotent_in_flight')   return 'authorization_unavailable'
  if (ec === 'duplicate_request_id')   return 'authorization_unavailable'
  return 'authorization_unavailable'
}

// ─── Gateway-enforced live search ─────────────────────────────────────────────

/**
 * Build a deterministic billing request ID for a given search page.
 *
 * The ID is stable for the same (account, search, page, refreshGen, UTC day):
 *   - refreshGen=0  — all ordinary retries reuse this ID (no double-charge)
 *   - refreshGen=N  — explicit user-initiated refresh; gets its own ID so it
 *                     is a new billable request; duplicate clicks at the same
 *                     N are still idempotent (same ID → DB blocks duplicate)
 *
 * Resets at UTC midnight, aligned with the 24-hour search_cache TTL.
 *
 * @param dayEpochOverride  Inject a fixed day epoch (for testing / loop coherence).
 * @param refreshGen        0 = normal/retry; 1+ = explicit refresh generation.
 */
export function buildBillingRequestId(
  accountId:         string,
  logicalSearchId:   string,
  pageNum:           number,
  dayEpochOverride?: number,
  refreshGen:        number = 0,
): string {
  const dayEpoch = dayEpochOverride ?? Math.floor(Date.now() / 86_400_000)
  return crypto
    .createHash('sha256')
    .update(`srch:${accountId}:${logicalSearchId}:p${pageNum}:g${refreshGen}:d${dayEpoch}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Execute a live REAPI criteria search through ProviderGateway.
 *
 * Authorization:
 *   - Reserved per page independently, each with a deterministic billing_request_id:
 *     sha256(account_id:logicalSearchId:page:dayEpoch)[:32]
 *   - Credit cost charged ONCE per search action (page 1 only; pages 2+ credit_cost=0).
 *   - Vendor cost estimated per page from the pricing catalog.
 *   - Idempotent: retrying the same search on the same day reuses the same
 *     billing_request_id. The DB handles duplicates via fn_reserve_budget_and_credits.
 *   - idempotent_duplicate (finalized): recover results from search_cache if available.
 *   - idempotent_in_flight (in-progress): return authorization_unavailable so the
 *     client retries after the concurrent request completes.
 *
 * Partial results:
 *   - If authorization succeeds for page N but fails for page N+1, the pages
 *     already retrieved are returned as 'partial_result' — results are never discarded.
 *   - If page 1 authorization fails, returns the appropriate block outcome
 *     (credit_insufficient, customer_pool_exhausted, etc.).
 *
 * Pool routing:
 *   - Comes from billing.pool_key (caller decides: customer_shared / owner_reserved
 *     / background_operations).
 *   - No automatic spillover between pools.
 */
export async function executeGatewaySearch(
  params:          SearchParams,
  billing:         BillingContext,
  logicalSearchId: string,
  config:          SearchGatewayConfig = DEFAULT_SEARCH_CONFIG,
  attemptId?:      string,
  refreshGen:      number = 0,
): Promise<GatewaySearchOutcome> {
  const apiKey = process.env.REAPI_KEY
  if (!apiKey) {
    return { outcome: 'provider_disabled', error_code: 'provider_not_configured', safe_message: 'Provider is not configured.' }
  }

  // Fetch pricing once — shared across all pages of this search action
  const pricing = await pricingEngine.getActivePricing(SEARCH_FEATURE_KEY)
  if (!pricing) {
    return { outcome: 'feature_disabled', error_code: 'feature_not_configured', safe_message: 'Search feature has no active pricing.' }
  }
  if (!pricing.is_enabled) {
    return { outcome: 'feature_disabled', error_code: 'feature_disabled', safe_message: pricing.disable_reason ?? 'Search feature is currently disabled.' }
  }
  if (pricing.requires_confirmed_cost && pricing.expected_vendor_cost_cents === 0) {
    return { outcome: 'feature_disabled', error_code: 'unknown_vendor_cost', safe_message: 'Search feature has unconfirmed vendor cost.' }
  }

  const properties: LiveProperty[] = []
  const seenIds    = new Set<string>()
  let pageIndex    = 1
  let totalInMarket = 0
  let pagesFetched = 0
  let vendorSpend  = 0
  // Compute day epoch once so all pages in this search use the same billing day.
  const dayEpoch = Math.floor(Date.now() / 86_400_000)

  if (attemptId) {
    console.info(`[Search] attempt_id=${attemptId} logicalSearchId=${logicalSearchId}`)
  }

  for (let pageNum = 1; pageNum <= config.maxPaidPages && properties.length < config.maxTotalRecords; pageNum++) {
    // Hard vendor cost guard — never schedule more spend than the configured max
    if (vendorSpend + pricing.expected_vendor_cost_cents > config.maxVendorCostCents) break

    // Credits charged only on the first page of each search action
    const credit_cost = (pageNum === 1 && !billing.is_background)
      ? pricing.customer_credit_cost
      : 0

    const request_id = buildBillingRequestId(billing.account_id, logicalSearchId, pageNum, dayEpoch, refreshGen)
    const start      = Date.now()

    const auth = await providerGateway.authorize({
      request_id,
      account_id:           billing.account_id,
      feature_key:          SEARCH_FEATURE_KEY,
      provider_key:         'reapi',
      pool_key:             billing.pool_key,
      estimated_cost_cents: pricing.expected_vendor_cost_cents,
      credit_cost,
      is_zero_cost_feature: false,
    })
    if (!auth.success) {
      const code = mapAuthToSearchOutcome(auth)

      // Idempotency response: the deterministic billing_request_id already exists.
      // idempotent_duplicate  — billing finalized; check search_cache for lost-response recovery.
      // idempotent_in_flight  — concurrent request in-progress; tell client to retry.
      // duplicate_request_id  — application-level 23505 fallback; treat as in-flight.
      if (auth.error_code === 'idempotent_duplicate') {
        if (pagesFetched > 0) {
          return {
            outcome:         'partial_result',
            properties,
            total:           totalInMarket,
            pages_fetched:   pagesFetched,
            blocked_at_page: pageNum,
            error_code:      'authorization_unavailable' as SearchOutcomeCode,
            safe_message:    'Showing partial results from this search.',
          }
        }
        // Lost-response recovery: billing was finalized but results not returned.
        // Re-check search_cache so the client gets results without a second provider call.
        try {
          const { data: cached } = await serviceClient
            .from('search_cache')
            .select('results, result_count')
            .eq('search_hash', logicalSearchId)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle()
          if (cached && Array.isArray(cached.results) && cached.results.length > 0) {
            const recovered = (cached.results as LiveProperty[]).slice(0, config.maxTotalRecords)
            console.info(
              `[Search] idempotent_duplicate — recovered ${recovered.length} results from cache ` +
              `request_id=${request_id} logicalSearchId=${logicalSearchId}`
            )
            return { outcome: 'success', properties: recovered, total: cached.result_count as number, pages_fetched: 0, has_more: recovered.length < (cached.result_count as number) }
          }
        } catch {
          // Cache unavailable — fall through to error
        }
        console.error(
          `[Search] idempotent_duplicate — no cache entry for logicalSearchId=${logicalSearchId} ` +
          `request_id=${request_id}. Provider was billed but results not cached.`
        )
        return {
          outcome:      'authorization_unavailable',
          error_code:   'idempotent_duplicate',
          safe_message: 'This search was recently completed. Please try again in a moment.',
        }
      }

      if (auth.error_code === 'idempotent_in_flight' || auth.error_code === 'duplicate_request_id') {
        console.info(
          `[Search] ${auth.error_code} — request_id=${request_id} page=${pageNum} ` +
          `is in-progress from a concurrent request. pages_fetched=${pagesFetched}`
        )
        if (pagesFetched > 0) {
          return {
            outcome:         'partial_result',
            properties,
            total:           totalInMarket,
            pages_fetched:   pagesFetched,
            blocked_at_page: pageNum,
            error_code:      'authorization_unavailable' as SearchOutcomeCode,
            safe_message:    'Showing partial results. A concurrent search is in progress.',
            has_more:        true,
          }
        }
        return {
          outcome:      'authorization_unavailable',
          error_code:   auth.error_code,
          safe_message: 'Search is already in progress. Please wait a moment and try again.',
        }
      }

      if (pagesFetched > 0) {
        return {
          outcome:         'partial_result',
          properties,
          total:           totalInMarket,
          pages_fetched:   pagesFetched,
          blocked_at_page: pageNum,
          error_code:      code,
          safe_message:    auth.error_message ?? 'Budget reached. Showing partial results.',
          has_more:        true,
        }
      }
      return {
        outcome:      code,
        error_code:   auth.error_code    ?? 'authorization_failed',
        safe_message: auth.error_message ?? 'This feature is currently unavailable.',
      }
    }

    try {
      const pageSize = Math.min(config.pageSize, config.maxTotalRecords - properties.length)
      const fetched  = await fetchREAPIPage(apiKey, params, pageIndex, pageSize)

      totalInMarket = fetched.total
      for (const p of fetched.page) {
        const norm = normaliseREAPIProperty(p)
        if (!seenIds.has(norm.id)) {
          seenIds.add(norm.id)
          properties.push(norm)
        }
      }

      pagesFetched++
      vendorSpend += pricing.expected_vendor_cost_cents

      providerHealthService.recordSuccess('reapi').catch(() => {})

      providerGateway.finalize({
        request_id,
        actual_cost_cents: pricing.expected_vendor_cost_cents,
        success:           true,
        duration_ms:       Date.now() - start,
      }).catch(e => console.error('[Search] finalize error:', e))

      // Stop if REAPI has no more results
      if (properties.length >= totalInMarket || fetched.returned < pageSize || fetched.page.length === 0) break
      pageIndex = fetched.nextIndex

    } catch (err) {
      const errMsg    = err instanceof Error ? err.message : String(err)
      const isAccount = err instanceof REAPIProviderAccountError
      const errCode   = isAccount ? 'reapi_account_insufficient' : 'provider_error'
      console.error(`[Search] REAPI page ${pageNum} failed (${errCode}):`, errMsg)

      // Record health event — fire-and-forget; never blocks the response path
      if (isAccount) {
        providerHealthService.recordHttpError('reapi', 402, errMsg).catch(() => {})
      } else {
        providerHealthService.recordEvent({ provider_key: 'reapi', status: 'server_error', error_category: 'provider_server_error', detail: errMsg }).catch(() => {})
      }

      providerGateway.finalize({
        request_id,
        actual_cost_cents: 0,
        success:           false,
        error_code:        errCode,
        duration_ms:       Date.now() - start,
      }).catch(() => {})

      if (pagesFetched > 0) {
        return {
          outcome:         'partial_result',
          properties,
          total:           totalInMarket,
          pages_fetched:   pagesFetched,
          blocked_at_page: pageNum,
          error_code:      isAccount ? 'reapi_account_insufficient' : 'provider_failed',
          safe_message:    isAccount ? errMsg : 'Provider error. Showing partial results.',
          has_more:        true,
        }
      }
      return {
        outcome:      isAccount ? 'provider_disabled' : 'provider_failed',
        error_code:   errCode,
        safe_message: errMsg,
      }
    }
  }

  return { outcome: 'success', properties, total: totalInMarket, pages_fetched: pagesFetched, has_more: properties.length < totalInMarket }
}

// ─── Legacy unguarded search (internal — not exported) ───────────────────────
// Kept as a reference implementation; no longer called from live/route.ts.
// Do not use in new code — use executeGatewaySearch instead.

async function executeREAPISearch(
  params: SearchParams,
  maxRecords = 500
): Promise<{ results: LiveProperty[]; total: number }> {
  const key = process.env.REAPI_KEY
  if (!key) throw new Error('REAPI_KEY is not configured')

  const results: LiveProperty[] = []
  const seenIds = new Set<string>()
  let pageIndex = 1
  let total = 0

  while (results.length < maxRecords) {
    const pageSize = Math.min(250, maxRecords - results.length)
    const fetched  = await fetchREAPIPage(key, params, pageIndex, pageSize)
    total = fetched.total

    for (const p of fetched.page) {
      const norm = normaliseREAPIProperty(p)
      if (!seenIds.has(norm.id)) {
        seenIds.add(norm.id)
        results.push(norm)
      }
    }

    if (results.length >= total || fetched.returned < pageSize || fetched.page.length === 0) break
    pageIndex = fetched.nextIndex
  }

  return { results, total }
}

// Prevent accidental import — suppress "unused variable" lint
void executeREAPISearch
