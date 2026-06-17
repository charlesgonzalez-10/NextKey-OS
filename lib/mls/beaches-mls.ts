/**
 * Beaches MLS (BMLS) adapter — Spark API / RESO Web API
 *
 * Beaches MLS runs on the Spark platform (FBS).  Credentials come from
 * the BMLS member portal: https://members.beachesmls.com → Tech Resources → API Access.
 *
 * Set ONE of the following in your .env.local:
 *
 *   Option A — Simple API key (most common for member access):
 *     BEACHES_MLS_API_KEY=<your bearer token>
 *
 *   Option B — OAuth 2.0 client credentials (for broker/system integrations):
 *     BEACHES_MLS_CLIENT_ID=<your client id>
 *     BEACHES_MLS_CLIENT_SECRET=<your client secret>
 *
 *   Optional — override the Spark endpoint if BMLS gives you a custom URL:
 *     BEACHES_MLS_API_URL=https://sparkapi.com/v1
 */

import type { PropertyComp, CompStatus } from '@/lib/enrichment/types'

// ─── Config ───────────────────────────────────────────────────────────────────

const SPARK_BASE  = (process.env.BEACHES_MLS_API_URL ?? 'https://sparkapi.com/v1').replace(/\/$/, '')
const API_KEY     = process.env.BEACHES_MLS_API_KEY
const CLIENT_ID   = process.env.BEACHES_MLS_CLIENT_ID
const CLIENT_SEC  = process.env.BEACHES_MLS_CLIENT_SECRET

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _tokenCache: { token: string; expiresAt: number } | null = null

async function getBearerToken(): Promise<string> {
  // Simple API key — use directly as bearer
  if (API_KEY) return API_KEY

  // OAuth 2.0 client credentials flow
  if (!CLIENT_ID || !CLIENT_SEC) {
    throw new BeachesMlsError(
      'NO_CREDENTIALS',
      'Beaches MLS credentials not configured. Set BEACHES_MLS_API_KEY in your .env.local.'
    )
  }

  // Return cached token if still valid (subtract 60s buffer)
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token
  }

  const res = await fetch('https://sparkplatform.com/openid/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SEC,
    }),
  })

  if (!res.ok) {
    throw new BeachesMlsError('AUTH_FAILED', `Spark token request failed: ${res.status}`)
  }

  const data = await res.json()
  _tokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000,
  }
  return data.access_token
}

// ─── Types ────────────────────────────────────────────────────────────────────

export class BeachesMlsError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

/** Spark API listing shape (RESO standard field names) */
interface SparkListing {
  ListingId?:               string
  ListingKey?:              string
  StandardStatus?:          string
  PropertyType?:            string
  PropertySubType?:         string
  StreetNumber?:            string
  StreetName?:              string
  StreetSuffix?:            string
  UnitNumber?:              string
  City?:                    string
  StateOrProvince?:         string
  PostalCode?:              string
  Latitude?:                number
  Longitude?:               number
  BedsTotal?:               number
  BathroomsTotalDecimal?:   number
  BathroomsFull?:           number
  AboveGradeFinishedArea?:  number
  LivingArea?:              number
  LotSizeSquareFeet?:       number
  YearBuilt?:               number
  ListPrice?:               number
  ClosePrice?:              number
  OriginalListPrice?:       number
  ListingContractDate?:     string
  CloseDate?:               string
  DaysOnMarket?:            number
  PriceChangeDate?:         string
  PreviousListPrice?:       number
  PublicRemarks?:           string
  ListAgentFullName?:       string
  ListOfficeName?:          string
}

export interface CompsResult {
  sold:               PropertyComp[]
  active:             PropertyComp[]
  pending:            PropertyComp[]
  median_sold_price:  number | null
  avg_price_per_sqft: number | null
  source:             'beaches-mls' | 'rentcast'
  radius_miles:       number
  fetched_at:         string
  subject_lat?:       number
  subject_lng?:       number
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────

/** Returns bounding box corners for a center point + radius in miles */
function boundingBox(lat: number, lng: number, radiusMi: number) {
  const latDelta = radiusMi / 69.0
  const lngDelta = radiusMi / (69.0 * Math.cos((lat * Math.PI) / 180))
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  }
}

/** Great-circle distance in miles between two lat/lng pairs */
function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R   = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a   = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2))
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

function mapStatus(s: string | undefined): CompStatus {
  switch (s?.toLowerCase()) {
    case 'closed':                  return 'sold'
    case 'active':                  return 'active'
    case 'active under contract':
    case 'pending':                 return 'pending'
    case 'expired':
    case 'withdrawn':
    case 'cancelled':               return 'expired'
    default:                        return 'active'
  }
}

function sparkToComp(
  l: SparkListing,
  subjectLat?: number,
  subjectLng?: number,
): PropertyComp {
  const sqft     = l.AboveGradeFinishedArea ?? l.LivingArea ?? null
  const price    = l.ClosePrice ?? l.ListPrice ?? null
  const ppsf     = sqft && price ? parseFloat((price / sqft).toFixed(0)) : null

  const addrParts = [l.StreetNumber, l.StreetName, l.StreetSuffix, l.UnitNumber].filter(Boolean)
  const address   = addrParts.join(' ')

  const dist = (subjectLat && subjectLng && l.Latitude && l.Longitude)
    ? distanceMiles(subjectLat, subjectLng, l.Latitude, l.Longitude)
    : null

  return {
    source:          'beaches-mls',
    mls_number:      l.ListingId ?? l.ListingKey ?? null,
    address,
    city:            l.City ?? '',
    zip:             l.PostalCode ?? '',
    beds:            l.BedsTotal ?? null,
    baths:           l.BathroomsTotalDecimal ?? l.BathroomsFull ?? null,
    living_area:     sqft,
    year_built:      l.YearBuilt ?? null,
    property_type:   l.PropertySubType ?? l.PropertyType ?? null,
    status:          mapStatus(l.StandardStatus),
    list_price:      l.ListPrice ?? null,
    sold_price:      l.ClosePrice ?? null,
    price_per_sqft:  ppsf,
    list_date:       l.ListingContractDate ?? null,
    sold_date:       l.CloseDate ?? null,
    days_on_market:  l.DaysOnMarket ?? null,
    rent_amount:     null,
    distance_miles:  dist,
    lat:             l.Latitude  ?? null,
    lng:             l.Longitude ?? null,
  }
}

// ─── Main fetch function ──────────────────────────────────────────────────────

const FIELDS = [
  'ListingId', 'ListingKey', 'StandardStatus', 'PropertyType', 'PropertySubType',
  'StreetNumber', 'StreetName', 'StreetSuffix', 'UnitNumber', 'City', 'PostalCode',
  'Latitude', 'Longitude',
  'BedsTotal', 'BathroomsTotalDecimal', 'BathroomsFull',
  'AboveGradeFinishedArea', 'LivingArea', 'YearBuilt',
  'ListPrice', 'ClosePrice', 'OriginalListPrice',
  'ListingContractDate', 'CloseDate', 'DaysOnMarket',
  'PriceChangeDate', 'PreviousListPrice',
].join(',')

export async function fetchComps(
  lat: number,
  lng: number,
  opts: {
    beds?:       number | null
    sqft?:       number | null
    radiusMi?:   number
    monthsBack?: number
  } = {}
): Promise<CompsResult> {
  const { radiusMi = 0.5, monthsBack = 12 } = opts
  const token = await getBearerToken()
  const bb    = boundingBox(lat, lng, radiusMi)
  const hdrs  = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - monthsBack)
  const cutoffDate = cutoff.toISOString().split('T')[0]

  const geoClause = [
    `Latitude ge ${bb.minLat.toFixed(5)}`,
    `Latitude le ${bb.maxLat.toFixed(5)}`,
    `Longitude ge ${bb.minLng.toFixed(5)}`,
    `Longitude le ${bb.maxLng.toFixed(5)}`,
  ].join(' and ')

  const soldFilter = [
    `PropertyType eq 'Residential'`,
    `StandardStatus eq 'Closed'`,
    `CloseDate ge ${cutoffDate}`,
    geoClause,
  ].join(' and ')

  const activeFilter = [
    `PropertyType eq 'Residential'`,
    `StandardStatus eq 'Active' or StandardStatus eq 'Active Under Contract'`,
    geoClause,
  ].join(' and ')

  const build = (filter: string, orderby: string, top: number) =>
    `${SPARK_BASE}/listings` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$select=${FIELDS}` +
    `&$orderby=${orderby}` +
    `&$top=${top}`

  const [soldRes, activeRes] = await Promise.all([
    fetch(build(soldFilter,   'CloseDate desc', 20), { headers: hdrs }),
    fetch(build(activeFilter, 'ListPrice asc',  10), { headers: hdrs }),
  ])

  const [soldData, activeData] = await Promise.all([
    soldRes.ok   ? soldRes.json()   : { value: [] },
    activeRes.ok ? activeRes.json() : { value: [] },
  ])

  const sold    = ((soldData.value   ?? []) as SparkListing[]).map(l => sparkToComp(l, lat, lng))
  const active  = ((activeData.value ?? []) as SparkListing[]).map(l => sparkToComp(l, lat, lng))

  // Filter active vs pending from the combined active fetch
  const trueActive  = active.filter(c => c.status === 'active')
  const pending     = active.filter(c => c.status === 'pending')

  // Stats
  const soldPrices   = sold.map(c => c.sold_price).filter((p): p is number => p != null)
  const sorted       = [...soldPrices].sort((a, b) => a - b)
  const medianSold   = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null

  const ppsfs        = sold.filter(c => c.price_per_sqft != null).map(c => c.price_per_sqft as number)
  const avgPpsf      = ppsfs.length ? Math.round(ppsfs.reduce((s, v) => s + v, 0) / ppsfs.length) : null

  return {
    sold,
    active:             trueActive,
    pending,
    median_sold_price:  medianSold,
    avg_price_per_sqft: avgPpsf,
    source:             'beaches-mls',
    radius_miles:       radiusMi,
    fetched_at:         new Date().toISOString(),
    subject_lat:        lat,
    subject_lng:        lng,
  }
}

/** Quick check: are credentials configured? */
export function beachesMlsConfigured(): boolean {
  return !!(API_KEY || (CLIENT_ID && CLIENT_SEC))
}
