/**
 * Broward County Property Appraiser (BCPA) adapter.
 * Free public API — no key required.
 *
 * Endpoints discovered by inspecting the BCPA AngularJS SPA (web.bcpa.net/BcpaClient/):
 *
 *   Address search: POST search.aspx/GetData
 *     → returns list of matching properties with folio + owner + siteAddress
 *
 *   Parcel detail: POST search.aspx/getParcelInformation
 *     → returns full property record for a given folio number
 *
 * Flow: search by address → take first folio → fetch full detail
 * Folio search: skip address search, go straight to detail
 *
 * If ANY request fails → returns null (REAPI fallback in caller)
 */

import type { PropertySourceResult } from './types'

const BCPA_BASE = 'https://web.bcpa.net/BcpaClient'
const CURRENT_TAX_YEAR = new Date().getFullYear().toString()
const TIMEOUT_MS = 12_000

// ─── Raw BCPA shapes ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BCPARecord = Record<string, any>

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse BCPA's currency-formatted strings like "$1,523,250" → 1523250 */
function parseCurrency(v: unknown): number | null {
  if (v == null) return null
  const n = Number(String(v).replace(/[$,]/g, '').trim())
  return isNaN(n) || n === 0 ? null : n
}

function getString(r: BCPARecord, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = r[k]
    if (v != null && String(v).trim() && String(v).trim() !== '0') return String(v).trim()
  }
  return null
}

function getNum(r: BCPARecord, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = r[k]
    if (v != null) {
      const n = Number(String(v).replace(/[$,]/g, '').trim())
      if (!isNaN(n) && n > 0) return n
    }
  }
  return null
}

async function bcpaFetch(path: string, body: BCPARecord): Promise<BCPARecord | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const resp = await fetch(`${BCPA_BASE}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Referer': `${BCPA_BASE}/search.aspx`,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) return null
    const json = await resp.json()
    // ASP.NET Web Methods wrap result in { d: ... }
    const d = json?.d
    if (d == null) return null
    return d
  } catch {
    return null
  }
}

// ─── Address search → list of matching folios ─────────────────────────────────

async function searchAddressForFolio(address: string, city?: string): Promise<string | null> {
  const searchValue = [address.toUpperCase(), city?.toUpperCase()].filter(Boolean).join(' ')
  const result = await bcpaFetch('search.aspx/GetData', {
    value: searchValue,
    cities: '',
    orderBy: '',
    pageNumber: '1',
    pageCount: '5',
    arrayOfValues: '',
    selectedFromList: 'false',
    totalCount: '0',
  })
  if (!result) return null
  const list: BCPARecord[] = result.resultListk__BackingField ?? []
  if (!list.length) return null
  return list[0].folioNumber ?? null
}

// ─── Parcel detail by folio ───────────────────────────────────────────────────

async function fetchParcelDetail(rawFolio: string): Promise<{ parcel: BCPARecord; recentSales: BCPARecord[] } | null> {
  // BCPA API requires folio with no dashes or separators (e.g. "484233080070" not "48-42-33-08-0070")
  const folio = rawFolio.replace(/[^0-9]/g, '')
  const result = await bcpaFetch('search.aspx/getParcelInformation', {
    folioNumber: folio,
    taxyear: CURRENT_TAX_YEAR,
    action: 'CURRENT',
    use: '',
  })
  if (!result) return null
  const parcelInfos: BCPARecord[] = result.parcelInfok__BackingField ?? []
  if (!parcelInfos.length) return null
  return {
    parcel: parcelInfos[0],
    recentSales: result.recentSalesk__BackingField ?? [],
  }
}

// ─── Normalize BCPA parcel → PropertySourceResult ────────────────────────────

function normalizeParcel(p: BCPARecord, sales: BCPARecord[]): PropertySourceResult {
  const folio = getString(p, 'folioNumber')

  // Mailing address
  const mail1 = getString(p, 'mailingAddress1') ?? ''
  const mail2 = getString(p, 'mailingAddress2') ?? ''
  const mailingAddress = [mail1, mail2].filter(Boolean).join(', ') || null

  // Property address
  const address1 = getString(p, 'situsAddress1') ?? ''
  const city     = getString(p, 'situsCity') ?? ''
  const zipRaw   = getString(p, 'situsZipCode') ?? ''
  const zip      = zipRaw.split('-')[0]  // strip extended zip suffix

  // Owner
  const owner1 = getString(p, 'ownerName1') ?? ''
  const owner2 = getString(p, 'ownerName2') ?? ''
  const ownerName = [owner1, owner2].filter(Boolean).join(' / ') || null

  // Mailing owner state (parse from mailingAddress2 like "PLANTATION, FL 33323")
  let ownerState: string | null = null
  let ownerZip:   string | null = null
  const mailParts = mail2.match(/,?\s*([A-Z]{2})\s+(\d{5}(-\d{4})?)/)
  if (mailParts) { ownerState = mailParts[1]; ownerZip = mailParts[2] }

  // Absentee: mailing address doesn't match situs address
  const absentee = Boolean(
    mail1 && address1 && !mail1.toUpperCase().startsWith(address1.toUpperCase().substring(0, 8))
  )

  // Building
  const livingArea   = getNum(p, 'bldgUnderAirFootage')
  const buildingArea = getNum(p, 'bldgTotSqFootage', 'bldgSqFT')
  const bedsRaw      = getString(p, 'beds')
  const bathsRaw     = getString(p, 'baths')
  const beds         = bedsRaw ? Number(bedsRaw) || null : null
  const baths        = bathsRaw ? Number(bathsRaw) || null : null
  const units        = getNum(p, 'units')

  // Year built: BCPA stores actual construction year as `actualAge`
  const yearBuilt = getNum(p, 'actualAge') ?? getNum(p, 'effectiveAge')

  // Valuations — BCPA formats them as "$1,523,250"
  const marketValue   = parseCurrency(p.justValue)
  const buildingValue = parseCurrency(p.bldgValue)
  const landValue     = parseCurrency(p.landValue)
  const taxableValue  = parseCurrency(p.taxableAmountCounty)
  // For homestead properties, SOH assessed value exists; otherwise use just value
  const assessedValue = parseCurrency(p.sohValue) ?? marketValue

  // Homestead
  const homesteadFlag  = getString(p, 'homesteadFlag') ?? ''
  const homestead      = homesteadFlag.includes('Y') || homesteadFlag.includes('H') ||
    (parseCurrency(p.he1Amount) != null)

  // Zoning — parsed from landCalcZoning like "RS-1EP - RESIDENTIAL SINGLE FAMILY"
  const zoningRaw = getString(p, 'landCalcZoning')
  const zoning    = zoningRaw?.split(' - ')[0] ?? null

  // Use code / property type
  const useCode    = getString(p, 'useCode')
  const subdivision = getString(p, 'neighborhood', 'improvementDistrict')
  const legalDesc  = getString(p, 'legal')

  // Sale history from recentSalesk__BackingField
  const lastSale  = sales[0]
  const prevSale  = sales[1]
  const lastSaleDate   = lastSale?.saleDate  ?? getString(p, 'saleDate1')  ?? null
  const lastSaleAmount = lastSale?.saleAmount != null
    ? parseCurrency(lastSale.saleAmount)
    : parseCurrency(p.stampAmount1)
  const prevSaleDate   = prevSale?.saleDate  ?? getString(p, 'saleDate2')  ?? null
  const prevSaleAmount = prevSale?.saleAmount != null
    ? parseCurrency(prevSale.saleAmount)
    : parseCurrency(p.stampAmount2)

  // Confidence: high if we have address + value + owner, medium if partial
  const confidence =
    address1 && ownerName && marketValue ? 85
    : address1 && ownerName ? 70
    : address1 ? 55
    : 30

  return {
    source:            'broward_pa',
    sourceType:        'public',
    sourceDisplayName: 'Broward County Property Appraiser',
    sourceUrl:         folio
      ? `https://web.bcpa.net/BcpaClient/#/Record-Search?${folio}`
      : 'https://web.bcpa.net/BcpaClient/#/Record-Search',
    confidence,

    folio,
    county:           'broward',
    property_address: address1,
    city,
    state:            'FL',
    zip,

    owner_name:      ownerName,
    mailing_address: mailingAddress,
    owner_state:     ownerState,
    owner_zip:       ownerZip,
    owner_country:   ownerState && ownerState !== 'FL' ? null : 'US',
    absentee_owner:  absentee,

    property_use:    useCode,
    zoning,
    legal_desc:      legalDesc,
    subdivision,
    neighborhood:    getString(p, 'neighborhood'),

    beds,
    baths,
    living_area:     livingArea,
    building_area:   buildingArea,
    units,
    year_built:      yearBuilt,

    market_value:    marketValue,
    assessed_value:  assessedValue,
    building_value:  buildingValue,
    land_value:      landValue,
    taxable_value:   taxableValue,

    homestead,

    last_sale_date:   lastSaleDate,
    last_sale_amount: lastSaleAmount,
    prev_sale_date:   prevSaleDate,
    prev_sale_amount: prevSaleAmount,

    pa_url: folio
      ? `https://www.bcpa.net/RecInfo.asp?URL_Folio=${folio}`
      : null,

    raw: p,
  }
}

// ─── Public exports ───────────────────────────────────────────────────────────

export async function searchByAddress(
  address: string,
  city?: string
): Promise<PropertySourceResult | null> {
  try {
    const folio = await searchAddressForFolio(address, city)
    if (!folio) {
      console.log(`[BrowardPA] No folio found for address: ${address}`)
      return null
    }
    return searchByFolio(folio)
  } catch (err) {
    console.warn('[BrowardPA] searchByAddress failed:', err)
    return null
  }
}

export async function searchByFolio(folio: string): Promise<PropertySourceResult | null> {
  try {
    const data = await fetchParcelDetail(folio)
    if (!data) {
      console.log(`[BrowardPA] No parcel detail for folio: ${folio}`)
      return null
    }
    return normalizeParcel(data.parcel, data.recentSales)
  } catch (err) {
    console.warn('[BrowardPA] searchByFolio failed:', err)
    return null
  }
}
