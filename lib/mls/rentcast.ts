/**
 * Rentcast API adapter — comps (via AVM) + active listings
 *
 * Get your API key at: https://app.rentcast.io/app/api-keys
 *
 * Endpoints used:
 *   GET /v1/avm/value?address=...        → AVM estimate + comparables (sold comps)
 *   GET /v1/listings/sale?address=...    → nearby active for-sale listings
 */

import type { PropertyComp } from '@/lib/enrichment/types'
import type { CompsResult } from './beaches-mls'

const BASE = 'https://api.rentcast.io/v1'
const KEY  = process.env.RENTCAST_API_KEY

export class RentcastError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

export function rentcastConfigured(): boolean {
  return !!KEY
}

async function get(path: string, params: Record<string, string>): Promise<unknown> {
  if (!KEY) throw new RentcastError('NO_CREDENTIALS', 'RENTCAST_API_KEY not set')
  const url = `${BASE}${path}?${new URLSearchParams(params)}`
  const res = await fetch(url, {
    headers: { 'X-Api-Key': KEY, Accept: 'application/json' },
  })
  if (res.status === 401) throw new RentcastError('AUTH_FAILED',  'Rentcast API key is invalid')
  if (res.status === 402) throw new RentcastError('QUOTA',        'Rentcast quota exceeded')
  if (res.status === 429) throw new RentcastError('RATE_LIMIT',   'Rentcast rate limit — retry shortly')
  if (res.status === 404) return null  // property not found — not an error
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new RentcastError('API_ERROR', `Rentcast ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

// ─── Comparables from AVM response ───────────────────────────────────────────

interface RentcastComp {
  id?:              string
  formattedAddress?: string
  price?:           number
  squareFootage?:   number
  bedrooms?:        number
  bathrooms?:       number
  distance?:        number
  daysOnMarket?:    number
  listedDate?:      string
  removedDate?:     string   // approx sale date for sold comps
  correlation?:     number
  latitude?:        number
  longitude?:       number
}

interface RentcastListing {
  id?:              string
  formattedAddress?: string
  addressLine1?:    string
  city?:            string
  state?:           string
  zipCode?:         string
  price?:           number
  squareFootage?:   number
  bedrooms?:        number
  bathrooms?:       number
  yearBuilt?:       number
  propertyType?:    string
  status?:          string
  listedDate?:      string
  daysOnMarket?:    number
  distance?:        number
  latitude?:        number
  longitude?:       number
}

function compToComp(c: RentcastComp): PropertyComp {
  const sqft  = c.squareFootage ?? null
  const price = c.price ?? null
  // Extract address from formattedAddress (before first comma)
  const addr  = c.formattedAddress?.split(',')[0] ?? ''
  const city  = c.formattedAddress?.split(',')[1]?.trim() ?? ''
  const zip   = c.formattedAddress?.match(/\b\d{5}\b/)?.[0] ?? ''

  return {
    source:          'rentcast',
    mls_number:      c.id ?? null,
    address:         addr,
    city,
    zip,
    beds:            c.bedrooms  ?? null,
    baths:           c.bathrooms ?? null,
    living_area:     sqft,
    year_built:      null,
    property_type:   null,
    status:          'sold',
    list_price:      null,
    sold_price:      price,
    price_per_sqft:  sqft && price ? Math.round(price / sqft) : null,
    list_date:       c.listedDate  ?? null,
    sold_date:       c.removedDate ?? null,
    days_on_market:  c.daysOnMarket ?? null,
    rent_amount:     null,
    distance_miles:  c.distance ?? null,
  }
}

function listingToComp(l: RentcastListing): PropertyComp {
  const sqft  = l.squareFootage ?? null
  const price = l.price ?? null
  const addr  = l.addressLine1 ?? l.formattedAddress?.split(',')[0] ?? ''
  const city  = l.city ?? l.formattedAddress?.split(',')[1]?.trim() ?? ''
  const zip   = l.zipCode ?? l.formattedAddress?.match(/\b\d{5}\b/)?.[0] ?? ''
  const s     = (l.status ?? '').toLowerCase()
  const status = s.includes('pend') ? 'pending' : 'active'

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
    distance_miles:  l.distance ?? null,
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchCompsRentcast(
  address: string,
  opts: { beds?: number | null; sqft?: number | null; radiusMi?: number } = {}
): Promise<CompsResult> {
  const { radiusMi = 0.5 } = opts

  const [avmData, listingsData] = await Promise.all([
    // AVM returns comparables (sold comps) — no radius param, Rentcast picks nearest
    get('/avm/value', { address }),
    // Active listings within radius
    get('/listings/sale', {
      address,
      radius: String(radiusMi),
      status: 'Active',
      limit:  '10',
    }),
  ])

  // Sold comps from AVM comparables
  const avmComps: RentcastComp[] = (avmData as { comparables?: RentcastComp[] } | null)?.comparables ?? []
  const sold = avmComps.map(compToComp)

  // Active/pending listings
  const listings: RentcastListing[] = Array.isArray(listingsData) ? listingsData : []
  const active  = listings.filter(l => !(l.status ?? '').toLowerCase().includes('pend')).map(listingToComp)
  const pending = listings.filter(l => (l.status ?? '').toLowerCase().includes('pend')).map(listingToComp)

  // Stats
  const soldPrices = sold.map(c => c.sold_price).filter((p): p is number => p != null)
  const sorted     = [...soldPrices].sort((a, b) => a - b)
  const medianSold = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null

  const ppsfs   = sold.filter(c => c.price_per_sqft != null).map(c => c.price_per_sqft as number)
  const avgPpsf = ppsfs.length ? Math.round(ppsfs.reduce((s, v) => s + v, 0) / ppsfs.length) : null

  return {
    sold,
    active,
    pending,
    median_sold_price:  medianSold,
    avg_price_per_sqft: avgPpsf,
    source:             'rentcast',
    radius_miles:       radiusMi,
    fetched_at:         new Date().toISOString(),
  }
}
