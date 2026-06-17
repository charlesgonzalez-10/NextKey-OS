/**
 * Rentcast API adapter — comps + active listings
 *
 * Get your API key at: https://app.rentcast.io/app/api-keys
 * Add to .env.local: RENTCAST_API_KEY=your_key_here
 *
 * Endpoints:
 *   GET /v1/avm/value               → subject lat/lng + AVM estimate
 *   GET /v1/properties/history/sale → sold comps with filter support
 *   GET /v1/listings/sale           → active/pending listings
 */

import type { PropertyComp } from '@/lib/enrichment/types'
import type { CompsResult } from './beaches-mls'

const BASE = 'https://api.rentcast.io/v1'
const KEY  = process.env.RENTCAST_API_KEY

export class RentcastError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

export function rentcastConfigured(): boolean { return !!KEY }

// ─── Filter shape (shared with frontend) ─────────────────────────────────────

export interface CompsFilter {
  radiusMi:     number
  monthsBack:   number
  propertyType: string        // '' = all types
  minPrice:     number | null
  maxPrice:     number | null
  beds:         number | null // exact match (Rentcast limitation)
  baths:        number | null // exact match
}

export const DEFAULT_FILTER: CompsFilter = {
  radiusMi:     0.5,
  monthsBack:   12,
  propertyType: '',
  minPrice:     null,
  maxPrice:     null,
  beds:         null,
  baths:        null,
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function get(path: string, params: Record<string, string>): Promise<unknown> {
  if (!KEY) throw new RentcastError('NO_CREDENTIALS', 'RENTCAST_API_KEY not set')
  const url = `${BASE}${path}?${new URLSearchParams(params)}`
  const res = await fetch(url, { headers: { 'X-Api-Key': KEY, Accept: 'application/json' } })
  if (res.status === 401) throw new RentcastError('AUTH_FAILED', 'Rentcast API key is invalid')
  if (res.status === 402) throw new RentcastError('QUOTA',       'Rentcast quota exceeded')
  if (res.status === 429) throw new RentcastError('RATE_LIMIT',  'Rentcast rate limit — retry shortly')
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new RentcastError('API_ERROR', `Rentcast ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

// ─── Types ────────────────────────────────────────────────────────────────────

// AVM comparable (returned by /avm/value)
interface RentcastAVMComp {
  id?:              string
  formattedAddress?: string
  addressLine1?:    string
  city?:            string
  state?:           string
  zipCode?:         string
  latitude?:        number
  longitude?:       number
  propertyType?:    string
  bedrooms?:        number
  bathrooms?:       number
  squareFootage?:   number
  yearBuilt?:       number
  status?:          string   // "Inactive" = sold/removed, "Active" = active listing
  price?:           number   // last known price
  listedDate?:      string
  removedDate?:     string   // approx sold date when status=Inactive
  daysOnMarket?:    number
  distance?:        number   // miles from subject
  daysOld?:         number   // days since active
  correlation?:     number
}

interface RentcastListing {
  id?:              string
  formattedAddress?: string
  addressLine1?:    string
  city?:            string
  state?:           string
  zipCode?:         string
  latitude?:        number
  longitude?:       number
  propertyType?:    string
  bedrooms?:        number
  bathrooms?:       number
  squareFootage?:   number
  yearBuilt?:       number
  price?:           number
  status?:          string
  listedDate?:      string
  daysOnMarket?:    number
  distance?:        number
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function avmCompToComp(c: RentcastAVMComp): PropertyComp {
  const sqft   = c.squareFootage ?? null
  const price  = c.price ?? null
  const addr   = c.addressLine1 ?? c.formattedAddress?.split(',')[0] ?? ''
  const city   = c.city ?? c.formattedAddress?.split(',')[1]?.trim() ?? ''
  const zip    = c.zipCode ?? c.formattedAddress?.match(/\b\d{5}\b/)?.[0] ?? ''
  const isSold = (c.status ?? '').toLowerCase() === 'inactive'

  return {
    source:         'rentcast',
    mls_number:     c.id ?? null,
    address:        addr,
    city,
    zip,
    beds:           c.bedrooms  ?? null,
    baths:          c.bathrooms ?? null,
    living_area:    sqft,
    year_built:     c.yearBuilt ?? null,
    property_type:  c.propertyType ?? null,
    status:         isSold ? 'sold' : 'active',
    list_price:     isSold ? null : price,
    sold_price:     isSold ? price : null,
    price_per_sqft: sqft && price ? Math.round(price / sqft) : null,
    list_date:      c.listedDate    ?? null,
    sold_date:      isSold ? (c.removedDate ?? null) : null,
    days_on_market: c.daysOnMarket  ?? null,
    rent_amount:    null,
    distance_miles: c.distance      ?? null,
    lat:            c.latitude      ?? null,
    lng:            c.longitude     ?? null,
  }
}

function listingToComp(l: RentcastListing): PropertyComp {
  const sqft   = l.squareFootage ?? null
  const price  = l.price ?? null
  const addr   = l.addressLine1 ?? l.formattedAddress?.split(',')[0] ?? ''
  const city   = l.city ?? l.formattedAddress?.split(',')[1]?.trim() ?? ''
  const zip    = l.zipCode ?? l.formattedAddress?.match(/\b\d{5}\b/)?.[0] ?? ''
  const status = (l.status ?? '').toLowerCase().includes('pend') ? 'pending' : 'active'

  return {
    source:          'rentcast',
    mls_number:      l.id ?? null,
    address:         addr,
    city,
    zip,
    beds:            l.bedrooms  ?? null,
    baths:           l.bathrooms ?? null,
    living_area:     sqft,
    year_built:      l.yearBuilt ?? null,
    property_type:   l.propertyType ?? null,
    status,
    list_price:      price,
    sold_price:      null,
    price_per_sqft:  sqft && price ? Math.round(price / sqft) : null,
    list_date:       l.listedDate ?? null,
    sold_date:       null,
    days_on_market:  l.daysOnMarket ?? null,
    rent_amount:     null,
    distance_miles:  l.distance  ?? null,
    lat:             l.latitude  ?? null,
    lng:             l.longitude ?? null,
  }
}

// ─── Main fetch ───────────────────────────────────────────────────────────────

export async function fetchCompsRentcast(
  address: string,
  filter: Partial<CompsFilter> = {}
): Promise<CompsResult & { avm_estimate?: number | null }> {
  const {
    radiusMi     = DEFAULT_FILTER.radiusMi,
    monthsBack   = DEFAULT_FILTER.monthsBack,
    propertyType = DEFAULT_FILTER.propertyType,
    minPrice,
    maxPrice,
    beds,
    baths,
  } = filter

  // Build active listings params (server-side filters supported)
  const activeParams: Record<string, string> = {
    address,
    radius: String(radiusMi),
    status: 'Active',
    limit:  '25',
  }
  if (propertyType) activeParams.propertyType = propertyType
  if (minPrice)     activeParams.minPrice      = String(minPrice)
  if (maxPrice)     activeParams.maxPrice      = String(maxPrice)
  if (beds)         activeParams.bedrooms      = String(beds)
  if (baths)        activeParams.bathrooms     = String(baths)

  // AVM returns subject coords + estimate + up to 40 comparables (Inactive = sold, Active = listing)
  const [listingsData, avmData] = await Promise.all([
    get('/listings/sale', activeParams),
    get('/avm/value', { address, compCount: '40' }),
  ])

  const avmResult   = avmData as { latitude?: number; longitude?: number; price?: number; comparables?: RentcastAVMComp[] } | null
  const subjectLat  = avmResult?.latitude  ?? null
  const subjectLng  = avmResult?.longitude ?? null
  const avmEstimate = avmResult?.price     ?? null
  const allAVMComps = avmResult?.comparables ?? []

  // Apply client-side filters to AVM comparables
  const maxDaysOld = Math.round(monthsBack * 30.5)
  const filteredAVM = allAVMComps.filter(c => {
    if ((c.daysOld ?? 0) > maxDaysOld) return false
    if ((c.distance ?? 0) > radiusMi)  return false
    if (propertyType && c.propertyType !== propertyType) return false
    const p = c.price ?? 0
    if (minPrice && p < minPrice) return false
    if (maxPrice && p > maxPrice) return false
    if (beds  && c.bedrooms  !== beds)  return false
    if (baths && c.bathrooms !== baths) return false
    return true
  })

  const sold    = filteredAVM.filter(c => (c.status ?? '').toLowerCase() === 'inactive').map(avmCompToComp)
  // Active from /listings/sale (server-filtered) takes precedence; fall back to AVM actives
  const listings = Array.isArray(listingsData) ? listingsData as RentcastListing[] : []
  const active  = listings.filter(l => !(l.status ?? '').toLowerCase().includes('pend')).map(listingToComp)
  const pending = listings.filter(l =>  (l.status ?? '').toLowerCase().includes('pend')).map(listingToComp)

  // Stats
  const soldPrices = sold.map(c => c.sold_price).filter((p): p is number => p != null)
  const sorted     = [...soldPrices].sort((a, b) => a - b)
  const medianSold = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
  const ppsfs      = sold.filter(c => c.price_per_sqft != null).map(c => c.price_per_sqft as number)
  const avgPpsf    = ppsfs.length ? Math.round(ppsfs.reduce((s, v) => s + v, 0) / ppsfs.length) : null

  return {
    sold,
    active,
    pending,
    median_sold_price:  medianSold,
    avg_price_per_sqft: avgPpsf,
    avm_estimate:       avmEstimate,
    source:             'rentcast',
    radius_miles:       radiusMi,
    fetched_at:         new Date().toISOString(),
    ...(subjectLat && subjectLng ? { subject_lat: subjectLat, subject_lng: subjectLng } : {}),
  }
}
