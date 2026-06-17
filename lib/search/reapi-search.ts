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

// ─── Execute search ───────────────────────────────────────────────────────────

const REAPI_BASE = 'https://api.realestateapi.com/v2'

/**
 * Execute a live REAPI search.
 * Fetches ALL pages (up to maxRecords) and returns normalised results.
 */
export async function executeREAPISearch(
  params: SearchParams,
  maxRecords = 500    // cap to control costs per search
): Promise<{ results: LiveProperty[]; total: number }> {
  const key = process.env.REAPI_KEY
  if (!key) throw new Error('REAPI_KEY is not configured')

  const results: LiveProperty[] = []
  const seenIds = new Set<string>()
  let resultIndex = 1
  let total = 0

  while (results.length < maxRecords) {
    const body = buildREAPIBody(params, resultIndex)
    const pageSize = Math.min(250, maxRecords - results.length)
    body.size = pageSize

    const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(25_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`REAPI ${res.status}: ${text.slice(0, 200)}`)
    }

    const data: REAPIResponse = await res.json()
    if (data.statusCode && data.statusCode !== 200) {
      throw new Error(`REAPI error ${data.statusCode}: ${data.message ?? data.statusMessage}`)
    }

    total = data.resultCount ?? 0
    const page = data.data ?? []

    for (const p of page) {
      const norm = normaliseREAPIProperty(p)
      if (!seenIds.has(norm.id)) {
        seenIds.add(norm.id)
        results.push(norm)
      }
    }

    const returned = data.recordCount ?? page.length
    if (results.length >= total || returned < pageSize || page.length === 0) break
    resultIndex = data.resultIndex ?? resultIndex + pageSize
  }

  return { results, total }
}
