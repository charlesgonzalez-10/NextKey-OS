/**
 * Palm Beach County Property Appraiser (PBCPAO) adapter.
 * Free public API — no key required.
 *
 * Tries two URL patterns for address search and one for folio search.
 * If ALL approaches fail or return HTML → returns null gracefully
 * (REAPI acts as fallback).
 *
 * NOTE: PBCPAO's public API endpoints are not officially documented.
 * If both approaches return null, verify the current endpoints by
 * inspecting network traffic at https://www.pbcpao.gov/property-search
 * and update the URLs accordingly.
 */

import type { PropertySourceResult } from './types'

const PBCPAO_BASE = 'https://www.pbcpao.gov'
const FETCH_TIMEOUT = 12_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PBCRecord = Record<string, any>

// ─── Field accessor helpers ───────────────────────────────────────────────────

function getStr(r: PBCRecord, ...keys: string[]): string | null {
  for (const k of keys) {
    if (r[k] != null && String(r[k]).trim()) return String(r[k]).trim()
  }
  return null
}

function getNum(r: PBCRecord, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = r[k]
    if (v != null) {
      const n = Number(v)
      if (!isNaN(n) && n > 0) return n
    }
  }
  return null
}

// ─── Safe JSON fetch (returns null on HTML or network error) ──────────────────

async function safeFetch(url: string): Promise<PBCRecord | PBCRecord[] | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal:  AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return null

    const text = await res.text()
    if (!text || text.trim().startsWith('<') || text.trim().startsWith('<!')) return null

    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  } catch {
    return null
  }
}

// ─── Result builder ───────────────────────────────────────────────────────────

function buildResult(r: PBCRecord, folio: string | null): PropertySourceResult {
  const folioParsed = folio
    ?? getStr(r, 'parcelId', 'ParcelId', 'folio', 'Folio', 'apn', 'APN')
  const address     = getStr(r, 'siteAddress', 'SiteAddress', 'propertyAddress', 'PropertyAddress', 'address')
  const owner       = getStr(r, 'ownerName', 'OwnerName', 'owner1', 'Owner1')
  const city        = getStr(r, 'city', 'City', 'siteCity', 'SiteCity')
  const zip         = getStr(r, 'zip', 'Zip', 'zipCode', 'ZipCode', 'siteZip')
  const justVal     = getNum(r, 'justValue', 'JustValue', 'marketValue', 'MarketValue')
  const assesVal    = getNum(r, 'assessedValue', 'AssessedValue')
  const beds        = getNum(r, 'bedrooms', 'Bedrooms', 'beds', 'Beds')
  const baths       = getNum(r, 'bathrooms', 'Bathrooms', 'baths', 'Baths', 'totalBaths')
  const sqft        = getNum(r, 'livingArea', 'LivingArea', 'squareFeet', 'SquareFeet')
  const yearBuilt   = getNum(r, 'yearBuilt', 'YearBuilt')
  const saleDate    = getStr(r, 'saleDate', 'SaleDate', 'lastSaleDate', 'LastSaleDate')
  const salePrice   = getNum(r, 'salePrice', 'SalePrice', 'lastSaleAmount', 'LastSaleAmount')

  const confidence =
    address && owner && (justVal || assesVal) ? 85 :
    address || owner ? 60 : 40

  return {
    source:            'palm_beach_pa',
    sourceType:        'public',
    sourceDisplayName: 'Palm Beach County Property Appraiser',
    sourceUrl:         folioParsed
      ? `${PBCPAO_BASE}/property-details/${folioParsed}`
      : null,
    confidence,

    folio:            folioParsed,
    county:           'palm-beach',
    property_address: address ?? undefined,
    city:             city ?? undefined,
    state:            'FL',
    zip:              zip ?? undefined,
    owner_name:       owner,
    mailing_address:  getStr(r, 'mailingAddress', 'MailingAddress') ?? null,
    owner_city:       getStr(r, 'mailingCity', 'MailingCity') ?? null,
    owner_state:      getStr(r, 'mailingState', 'MailingState') ?? null,
    owner_zip:        getStr(r, 'mailingZip', 'MailingZip') ?? null,
    beds,
    baths,
    living_area:      sqft,
    year_built:       yearBuilt,
    market_value:     justVal,
    assessed_value:   assesVal,
    last_sale_date:   saleDate,
    last_sale_amount: salePrice,
    pa_url:           folioParsed
      ? `${PBCPAO_BASE}/property-details/${folioParsed}`
      : null,
    raw: r,
  }
}

// ─── Public: search by address ────────────────────────────────────────────────

export async function searchByAddress(
  address: string,
  _city?: string
): Promise<PropertySourceResult | null> {
  const encoded = encodeURIComponent(address.trim())

  // Approach A: newer REST endpoint
  const urlA = `${PBCPAO_BASE}/api/search?q=${encoded}&type=address`
  let data = await safeFetch(urlA)

  // Approach B: older DesktopModules search service
  if (!data) {
    const urlB = `${PBCPAO_BASE}/DesktopModules/PA.PropertySearch/Services/SearchService.ashx?SearchType=address&SearchValue=${encoded}`
    data = await safeFetch(urlB)
  }

  if (!data) {
    console.log(`[PalmBeachPA] No result for address: ${address}`)
    return null
  }

  // Normalize array vs object
  const records: PBCRecord[] = Array.isArray(data)
    ? data
    : (data as PBCRecord).results ? (data as PBCRecord).results
    : (data as PBCRecord).data    ? (Array.isArray((data as PBCRecord).data) ? (data as PBCRecord).data : [(data as PBCRecord).data])
    : [data as PBCRecord]

  const first = records[0]
  if (!first || Object.keys(first).length === 0) return null

  return buildResult(first, null)
}

// ─── Public: search by folio ──────────────────────────────────────────────────

export async function searchByFolio(
  folio: string
): Promise<PropertySourceResult | null> {
  const encoded = encodeURIComponent(folio)

  const url = `${PBCPAO_BASE}/api/search?q=${encoded}&type=folio`
  const data = await safeFetch(url)

  if (!data) {
    console.log(`[PalmBeachPA] No result for folio: ${folio}`)
    return null
  }

  const records: PBCRecord[] = Array.isArray(data)
    ? data
    : (data as PBCRecord).results ? (data as PBCRecord).results
    : [data as PBCRecord]

  const first = records[0]
  if (!first || Object.keys(first).length === 0) return null

  return buildResult(first, folio)
}
