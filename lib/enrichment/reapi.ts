/**
 * RealEstateAPI.com (REAPI) Client
 * Covers Broward + Palm Beach county PA data.
 * Miami-Dade is handled separately via the free MD REST API.
 *
 * Uses /v2/PropertySearch which does fuzzy address matching and returns
 * richer data than /v2/PropertyDetail (which requires exact address format).
 *
 * Docs: https://developer.realestateapi.com/
 * Key:  REAPI_KEY env var (server-side only)
 */

import type { PropertySearchResult, County } from './types'

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

// ─── Core API fetch ───────────────────────────────────────────────────────────

function getKey(): string {
  const key = process.env.REAPI_KEY
  if (!key) throw new Error('REAPI_KEY environment variable is not set')
  return key
}

async function reapiFetch(
  path: string,
  body: Record<string, unknown>
): Promise<REAPISearchResponse> {
  const res = await fetch(`${REAPI_BASE}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    getKey(),
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`REAPI ${path} HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// ─── Property search by address ───────────────────────────────────────────────

export async function searchPropertiesByAddress(
  address: string,
  county: County,
  limit = 10
): Promise<PropertySearchResult[]> {
  try {
    const data = await reapiFetch('/PropertySearch', {
      address,
      size: limit,
    })

    const items: REAPIProperty[] = Array.isArray(data.data)
      ? data.data
      : data.data ? [data.data] : (data.results ?? [])

    return items.map(item => normalizeREAPIProperty(item, county))
  } catch (err) {
    console.error('[REAPI] searchPropertiesByAddress failed:', err)
    return []
  }
}

// ─── Single property lookup (best match) ─────────────────────────────────────

export async function getPropertyDetailByAddress(
  address: string,
  county: County
): Promise<PropertySearchResult | null> {
  const results = await searchPropertiesByAddress(address, county, 1)
  return results[0] ?? null
}

// ─── Lookup by APN/folio ─────────────────────────────────────────────────────

export async function getPropertyByAPN(
  apn: string,
  county: County
): Promise<PropertySearchResult | null> {
  try {
    const data = await reapiFetch('/PropertySearch', {
      apn,
      size: 1,
    })

    const items: REAPIProperty[] = Array.isArray(data.data)
      ? data.data
      : data.data ? [data.data] : (data.results ?? [])

    const raw = items[0]
    return raw ? normalizeREAPIProperty(raw, county) : null
  } catch (err) {
    console.error('[REAPI] getPropertyByAPN failed:', err)
    return null
  }
}
