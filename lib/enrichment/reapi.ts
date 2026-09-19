/**
 * RealEstateAPI.com (REAPI) Client — gateway-enforced.
 *
 * Every call to REAPI goes through providerGateway.authorize() before the
 * HTTP request is made. If authorization fails (budget exceeded, feature
 * disabled, service unavailable), the call is blocked and no HTTP request
 * is made. Billing is finalized after the provider responds.
 *
 * Fail closed: any gate failure → blocked outcome. Provider errors →
 * provider_failed outcome. Reservations are always released on failure.
 *
 * Background calls (BACKGROUND_CONTEXT) reserve the real vendor cost estimate
 * from the pricing catalog. Gate 2 is bypassed in fn_reserve_budget_and_credits
 * for the background system account; gate 3 (background_operations pool = 500¢/month)
 * is the sole throttle. credit_cost is always 0 for background ops.
 */

import { randomUUID } from 'crypto'
import type { PropertySearchResult, County } from './types'
import type { BillingContext, EnrichmentOutcome } from '@/lib/billing/gatewayContext'
import { providerGateway } from '@/lib/billing/providerGateway'
import { pricingEngine } from '@/lib/billing/pricingEngine'

const REAPI_BASE = 'https://api.realestateapi.com/v2'

// ─── Raw REAPI PropertySearch response ───────────────────────────────────────

interface REAPIAddress {
  address?: string
  city?:    string
  county?:  string
  fips?:    string
  state?:   string
  street?:  string
  zip?:     string
}

interface REAPINeighborhood {
  id?:   string
  name?: string
  type?: string
}

export interface REAPIProperty {
  // Identity
  id?:           string
  propertyId?:   string
  apn?:          string

  // Address
  address?:      REAPIAddress
  mailAddress?:  REAPIAddress
  latitude?:     number
  longitude?:    number

  // Owner
  owner1FirstName?: string
  owner1LastName?:  string
  owner2FirstName?: string
  owner2LastName?:  string
  absenteeOwner?:          boolean
  outOfStateAbsenteeOwner?: boolean
  inStateAbsenteeOwner?:   boolean
  ownerOccupied?:          boolean

  // Property
  propertyType?:    string
  propertyUse?:     string
  propertyUseCode?: number
  landUse?:         string
  neighborhood?:    REAPINeighborhood
  stories?:         number
  unitsCount?:      number

  // Building
  bedrooms?:        number
  bathrooms?:       number
  squareFeet?:      number
  lotSquareFeet?:   number
  yearBuilt?:       number
  pool?:            boolean
  garage?:          boolean
  basement?:        boolean

  // Valuation
  estimatedValue?:          number
  assessedValue?:           number
  assessedLandValue?:       number
  assessedImprovementValue?: number
  pricePerSquareFoot?:      number
  equityPercent?:           number
  estimatedEquity?:         number
  openMortgageBalance?:     number

  // Rental
  suggestedRent?:  string | number
  rentAmount?:     number | null

  // Tax
  taxLien?:        boolean

  // Sale history
  lastSaleDate?:          string
  lastSaleAmount?:        string | number
  lastSaleArmsLength?:    boolean
  latestArmsLengthSaleAmount?: number
  latestArmsLengthSaleDate?:   string
  priorSaleDate?:         string
  priorSaleAmount?:       number | null

  // Status flags
  foreclosure?:     boolean
  preForeclosure?:  boolean
  reo?:             boolean
  auction?:         boolean
  vacant?:          boolean
  forSale?:         boolean
  freeClear?:       boolean
  highEquity?:      boolean
  mlsActive?:       boolean
  mlsPending?:      boolean
  mlsSold?:         boolean
  mlsStatus?:       string
  mlsListingPrice?: number

  // Mortgage
  lenderName?:           string
  lastMortgage1Amount?:  number | null
  documentType?:         string

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface REAPISearchResponse {
  statusCode?:  number
  statusMessage?: string
  data?:        REAPIProperty | REAPIProperty[]
  results?:     REAPIProperty[]
  reason?:      string
}

// ─── County FIPS codes ───────────────────────────────────────────────────────

const COUNTY_FIPS: Record<string, string> = {
  'broward':    '12011',
  'palm-beach': '12099',
  'miami-dade': '12086',
}

// ─── PA website link builder ─────────────────────────────────────────────────

function buildPAUrl(county: County, apn: string | null): string | null {
  if (!apn) return null
  switch (county) {
    case 'broward':
      return `https://bcpa.net/RecordDetail.asp?URL_FOLIO=${apn}`
    case 'palm-beach':
      return `https://pbcpao.gov/Property/Details/${apn}`
    default:
      return null
  }
}

// ─── Normalize REAPI response → PropertySearchResult ─────────────────────────

export function normalizeREAPIProperty(
  raw: REAPIProperty,
  county: County
): PropertySearchResult {
  const addr     = raw.address     ?? {}
  const mailAddr = raw.mailAddress ?? {}

  const propAddrStr = addr.address ?? addr.street ?? ''
  const mailAddrStr = mailAddr.address
    ? `${mailAddr.address}`
    : [mailAddr.street, mailAddr.city, mailAddr.state, mailAddr.zip]
        .filter(Boolean).join(', ')

  const ownerParts = [
    [raw.owner1FirstName, raw.owner1LastName].filter(Boolean).join(' '),
    [raw.owner2FirstName, raw.owner2LastName].filter(Boolean).join(' '),
  ].filter(Boolean)
  const ownerName = ownerParts.join(' / ') || null

  const lastSaleAmt = raw.lastSaleAmount != null
    ? Number(raw.lastSaleAmount)
    : null

  const suggestedRent = raw.suggestedRent != null
    ? Number(raw.suggestedRent)
    : null

  return {
    folio:            raw.apn ?? null,
    county,
    source:           'reapi',

    property_address: propAddrStr,
    city:             addr.city    ?? '',
    state:            addr.state   ?? 'FL',
    zip:              addr.zip     ?? '',

    owner_name:       ownerName,
    mailing_address:  mailAddrStr || null,
    owner_city:       mailAddr.city    ?? null,
    owner_state:      mailAddr.state   ?? null,
    owner_zip:        mailAddr.zip     ?? null,
    owner_country:    null,
    absentee_owner:   raw.absenteeOwner ?? false,

    property_use:     raw.propertyUse  ?? raw.landUse ?? null,
    zoning:           null,
    legal_desc:       null,
    subdivision:      raw.neighborhood?.name ?? null,
    neighborhood:     raw.neighborhood?.name ?? null,
    municipality:     addr.city ?? null,

    beds:             raw.bedrooms     ?? null,
    baths:            raw.bathrooms    ?? null,
    half_baths:       null,
    living_area:      raw.squareFeet   ?? null,
    building_area:    raw.squareFeet   ?? null,
    lot_size:         raw.lotSquareFeet ?? null,
    year_built:       raw.yearBuilt    ?? null,
    stories:          raw.stories      ?? null,
    units:            raw.unitsCount   ?? null,

    market_value:     raw.estimatedValue           ?? null,
    assessed_value:   raw.assessedValue            ?? null,
    land_value:       raw.assessedLandValue        ?? null,
    building_value:   raw.assessedImprovementValue ?? null,
    tax_year:         null,
    annual_taxes:     null,

    last_sale_date:   raw.lastSaleDate   ?? null,
    last_sale_amount: isNaN(lastSaleAmt!) ? null : lastSaleAmt,
    prev_sale_date:   raw.priorSaleDate  ?? null,
    prev_sale_amount: raw.priorSaleAmount ?? null,

    // Extra REAPI-specific fields stored in raw for display
    pa_url: buildPAUrl(county, raw.apn ?? null),
    raw: {
      ...raw,
      // Computed extras surfaced for the UI
      _suggested_rent:    suggestedRent,
      _equity_percent:    raw.equityPercent    ?? null,
      _estimated_equity:  raw.estimatedEquity  ?? null,
      _free_clear:        raw.freeClear        ?? false,
      _high_equity:       raw.highEquity       ?? false,
      _vacant:            raw.vacant           ?? false,
      _foreclosure:       raw.foreclosure      ?? false,
      _pre_foreclosure:   raw.preForeclosure   ?? false,
      _mls_active:        raw.mlsActive        ?? false,
      _tax_lien:          raw.taxLien          ?? false,
      _latitude:          raw.latitude         ?? null,
      _longitude:         raw.longitude        ?? null,
    },
  }
}

// ─── Detect county from zip code ─────────────────────────────────────────────

const BROWARD_ZIPS = new Set([
  '33004','33009','33010','33012','33013','33014','33015','33016',
  '33019','33020','33021','33022','33023','33024','33025','33026',
  '33027','33028','33029','33060','33061','33062','33063','33064',
  '33065','33066','33067','33068','33069','33071','33073','33074',
  '33075','33076','33077','33083','33084','33093','33097',
  '33301','33302','33303','33304','33305','33306','33307','33308',
  '33309','33310','33311','33312','33313','33314','33315','33316',
  '33317','33318','33319','33320','33321','33322','33323','33324',
  '33325','33326','33327','33328','33329','33330','33331','33332',
  '33334','33335','33336','33337','33338','33339','33340','33345',
  '33346','33348','33349','33351','33355','33359','33388','33394',
])

const PALM_BEACH_ZIPS = new Set([
  '33401','33403','33404','33405','33406','33407','33408','33409',
  '33410','33411','33412','33413','33414','33415','33416','33417',
  '33418','33419','33420','33421','33422','33424','33425','33426',
  '33428','33430','33431','33432','33433','33434','33435','33436',
  '33437','33438','33440','33441','33444','33445','33446','33447',
  '33448','33449','33458','33460','33461','33462','33463','33467',
  '33469','33470','33471','33472','33473','33474','33476','33477',
  '33478','33480','33483','33484','33486','33487','33493','33496','33498',
])

export function detectCountyFromZip(zip: string): County {
  const z = zip.trim().slice(0, 5)
  if (BROWARD_ZIPS.has(z))    return 'broward'
  if (PALM_BEACH_ZIPS.has(z)) return 'palm-beach'
  if (/^33[0-3]/.test(z))     return 'miami-dade'
  return 'unknown'
}

// ─── Gateway-enforced core fetch ──────────────────────────────────────────────
//
// Every REAPI HTTP call goes through this function. It:
//   1. Checks REAPI_KEY is configured (fail closed if missing)
//   2. Looks up feature pricing to enforce gate 6 (enabled, confirmed cost)
//   3. Calls providerGateway.authorize() for gates 1-5 + atomic reservation
//   4. Makes the HTTP fetch
//   5. Calls providerGateway.finalize() to reconcile actual cost
//
// Background context: real estimated_cost_cents from catalog (gate 2 is bypassed
// in the RPC for the background system account; gate 3 pool is the throttle).
// credit_cost is 0 for background — credits are never charged for system ops.

async function reapiFetch(
  path: string,
  body: Record<string, unknown>,
  billing: BillingContext,
  featureKey: string
): Promise<EnrichmentOutcome<REAPISearchResponse>> {
  const key = process.env.REAPI_KEY
  if (!key) {
    return { outcome: 'blocked', error_code: 'provider_not_configured', safe_message: 'Provider is not configured.' }
  }

  const pricing = await pricingEngine.getActivePricing(featureKey)

  if (!pricing) {
    return { outcome: 'blocked', error_code: 'feature_not_configured', safe_message: 'Feature has no active pricing configuration.' }
  }

  if (!pricing.is_enabled) {
    return { outcome: 'blocked', error_code: 'feature_disabled', safe_message: pricing.disable_reason ?? 'Feature is currently disabled.' }
  }

  if (pricing.requires_confirmed_cost && pricing.expected_vendor_cost_cents === 0) {
    return { outcome: 'blocked', error_code: 'unknown_vendor_cost', safe_message: 'Feature has unconfirmed vendor cost.' }
  }

  const request_id = randomUUID()

  // All contexts — including background — must reserve the real vendor cost estimate.
  // is_background only suppresses credit_cost (customers are never charged for cron ops).
  const estimated_cost_cents = pricing.expected_vendor_cost_cents
  const credit_cost          = billing.is_background ? 0 : pricing.customer_credit_cost

  const auth = await providerGateway.authorize({
    request_id,
    account_id:            billing.account_id,
    feature_key:           featureKey,
    provider_key:          'reapi',
    pool_key:              billing.pool_key,
    estimated_cost_cents,
    credit_cost,
    is_zero_cost_feature:  false,
  })

  if (!auth.success) {
    return {
      outcome:      'blocked',
      error_code:   auth.error_code    ?? 'authorization_failed',
      safe_message: auth.error_message ?? 'This feature is currently unavailable.',
    }
  }

  const start = Date.now()

  try {
    const res = await fetch(`${REAPI_BASE}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      providerGateway.finalize({
        request_id,
        actual_cost_cents: 0,
        success:           false,
        error_code:        `http_${res.status}`,
        duration_ms:       Date.now() - start,
      }).catch(e => console.error('[REAPI] finalize error:', e))
      return { outcome: 'provider_failed', error: `REAPI ${path} HTTP ${res.status}: ${text.slice(0, 200)}` }
    }

    const data: REAPISearchResponse = await res.json()

    providerGateway.finalize({
      request_id,
      actual_cost_cents: pricing.expected_vendor_cost_cents,
      success:           true,
      duration_ms:       Date.now() - start,
    }).catch(e => console.error('[REAPI] finalize error:', e))

    return { outcome: 'success', data, request_id }

  } catch (err) {
    providerGateway.finalize({
      request_id,
      actual_cost_cents: 0,
      success:           false,
      error_code:        'provider_timeout_or_error',
      duration_ms:       Date.now() - start,
    }).catch(e => console.error('[REAPI] finalize error:', e))
    return { outcome: 'provider_failed', error: String(err) }
  }
}

// ─── Property search by address ───────────────────────────────────────────────

export async function searchPropertiesByAddress(
  address: string,
  county: County,
  limit: number,
  billing: BillingContext
): Promise<EnrichmentOutcome<PropertySearchResult[]>> {
  const result = await reapiFetch('/PropertySearch', { address, size: limit }, billing, 'property_lookup_basic')

  if (result.outcome !== 'success') return result

  const items: REAPIProperty[] = Array.isArray(result.data.data)
    ? result.data.data
    : result.data.data ? [result.data.data] : (result.data.results ?? [])

  return {
    outcome:    'success',
    data:       items.map(item => normalizeREAPIProperty(item, county)),
    request_id: result.request_id,
  }
}

// ─── Single property lookup (best match) ─────────────────────────────────────

export async function getPropertyDetailByAddress(
  address: string,
  county: County,
  billing: BillingContext
): Promise<EnrichmentOutcome<PropertySearchResult | null>> {
  const result = await searchPropertiesByAddress(address, county, 1, billing)
  if (result.outcome !== 'success') return result
  return { outcome: 'success', data: result.data[0] ?? null, request_id: result.request_id }
}

// ─── Lookup by APN/folio ─────────────────────────────────────────────────────

export async function getPropertyByAPN(
  apn: string,
  county: County,
  billing: BillingContext
): Promise<EnrichmentOutcome<PropertySearchResult | null>> {
  const result = await reapiFetch('/PropertySearch', { apn, size: 1 }, billing, 'property_report_full')

  if (result.outcome !== 'success') return result

  const items: REAPIProperty[] = Array.isArray(result.data.data)
    ? result.data.data
    : result.data.data ? [result.data.data] : (result.data.results ?? [])

  const raw = items[0]
  return {
    outcome:    'success',
    data:       raw ? normalizeREAPIProperty(raw, county) : null,
    request_id: result.request_id,
  }
}

// ─── Lookup by coordinates (lat/lng) ─────────────────────────────────────────

export async function getPropertyByCoords(
  lat: number,
  lng: number,
  county: County,
  billing: BillingContext
): Promise<EnrichmentOutcome<PropertySearchResult | null>> {
  const result = await reapiFetch(
    '/PropertySearch',
    { latitude: lat, longitude: lng, radius: 0.05, size: 1 },
    billing,
    'property_lookup_basic'
  )

  if (result.outcome !== 'success') return result

  const items: REAPIProperty[] = Array.isArray(result.data.data)
    ? result.data.data
    : result.data.data ? [result.data.data] : (result.data.results ?? [])

  const raw = items[0]
  return {
    outcome:    'success',
    data:       raw ? normalizeREAPIProperty(raw, county) : null,
    request_id: result.request_id,
  }
}
