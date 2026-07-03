/**
 * Palm Beach County Property Appraiser (PBCPAO) adapter.
 * Free — no API key required.
 *
 * Discovery (2025-07-02): The public JSON endpoints (/api/search, /DesktopModules/...)
 * were retired. PBCPAO now serves all property data as an embedded JS object on
 * the property detail page:
 *
 *   GET https://pbcpao.gov/Property/Details?parcelId=<PCN>
 *     → HTML containing: var model = { propertyDetail: {...}, salesInfo: [...], ... }
 *
 * Folio search: fully supported via this endpoint.
 * Address search: the address→PCN lookup (giswebapi/anysearch) requires browser
 *   authentication and cannot be called server-side. Returns null → REAPI fallback.
 *
 * PCN format accepted: with or without dashes (74-42-43-13-24-040-5450 or 74424313240405450).
 */

import type { PropertySourceResult } from './types'

const PBCPAO_BASE = 'https://pbcpao.gov'
const FETCH_TIMEOUT = 15_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PBCRecord = Record<string, any>

// ─── Page fetch + model extraction ───────────────────────────────────────────

async function fetchPropertyModel(folio: string): Promise<PBCRecord | null> {
  try {
    const url = `${PBCPAO_BASE}/Property/Details?parcelId=${encodeURIComponent(folio)}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return null

    const html = await res.text()
    if (!html.includes('var model = {')) {
      console.log('[PalmBeachPA] model not found in page for folio:', folio)
      return null
    }

    // Extract the JSON object assigned to `var model = {...}`
    const start = html.indexOf('var model = {') + 'var model = '.length
    let depth = 0
    let end = start
    for (let i = start; i < html.length; i++) {
      if (html[i] === '{') depth++
      else if (html[i] === '}') {
        depth--
        if (depth === 0) { end = i + 1; break }
      }
    }

    return JSON.parse(html.slice(start, end))
  } catch (err) {
    console.warn('[PalmBeachPA] fetchPropertyModel error:', err)
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = Number(String(v).replace(/[$,]/g, ''))
  return isNaN(n) || n === 0 ? null : n
}

/** Extract a structural element value by its ElementName */
function structVal(elements: PBCRecord[], name: string): string | null {
  const el = elements.find(e => e.ElementName?.trim().toLowerCase() === name.toLowerCase())
  return el ? str(el.ElementValue) : null
}

// ─── Normalize model → PropertySourceResult ───────────────────────────────────

function normalizeModel(model: PBCRecord, requestedFolio: string): PropertySourceResult {
  const detail   = model.propertyDetail ?? {}
  const sales    = model.salesInfo ?? []
  const assess   = model.assessmentInfo ?? []
  const appraise = model.appraisalInfo ?? []
  const structs  = model.structuralDetails?.StructuralElements ?? []

  // Folio: prefer FormattedPCN (dashed) from the page, fall back to what we requested
  const folio = str(detail.FormattedPCN) ?? requestedFolio

  // Property address
  const propertyAddress = str(detail.Location)
  const city    = str(detail.Municipality)
  const zip     = str(detail.ZipCode)

  // Owner
  const ownerName = str(detail.OwnerName)

  // Mailing address — AddressLine1 + AddressLine3 ("609 2ND ST APT 600", "WEST PALM BCH FL 33401 4529")
  const mailLine1 = str(detail.AddressLine1)
  const mailLine3 = str(detail.AddressLine3)
  const mailingAddress = [mailLine1, mailLine3].filter(Boolean).join(', ') || null

  // Parse state + zip from AddressLine3 (e.g. "WEST PALM BCH FL 33401 4529")
  let ownerState: string | null = null
  let ownerZip:   string | null = null
  if (mailLine3) {
    const m = mailLine3.match(/\b([A-Z]{2})\s+(\d{5})/)
    if (m) { ownerState = m[1]; ownerZip = m[2] }
  }

  // Legal + zoning + use
  const legalDesc  = str(detail.LegalDesc)
  const subdivision = str(detail.Subdivision)
  const zoning     = str(detail.Zoning)

  // Building from structural elements
  const yearBuiltStr = structVal(structs, 'Year Built')
  const bedsStr      = structVal(structs, 'No of Bedroom(s)')
  const bathsStr     = structVal(structs, 'No of Bath(s)')
  const livingAreaStr = structVal(structs, 'Area Under Air') ?? structVal(structs, 'Area')
  const yearBuilt    = yearBuiltStr ? Number(yearBuiltStr) || null : null
  const beds         = bedsStr  ? Number(bedsStr)  || null : null
  const baths        = bathsStr ? Number(bathsStr) || null : null
  const livingArea   = livingAreaStr ? Number(livingAreaStr) || null : num(detail.SqFt)

  // Valuation — current year (index 0 is always most recent)
  const currentAppraise  = appraise[0] ?? {}
  const currentAssess    = assess[0] ?? {}
  const marketValue   = num(currentAppraise.TotalMarketValue)
  const buildingValue = num(currentAppraise.ImprovementValue)
  const landValue     = num(currentAppraise.LandValue)
  const assessedValue = num(currentAssess.AssessedValue)
  const taxYearStr    = str(currentAssess.TaxYear) ?? str(detail.TaxYear)
  const taxYear       = taxYearStr ? Number(taxYearStr) || null : null

  // Sales
  const lastSale   = sales[0] ?? {}
  const prevSale   = sales[1] ?? {}
  const lastSaleDate   = str(lastSale.SaleDate)
  const lastSaleAmount = num(lastSale.Price)
  const prevSaleDate   = str(prevSale.SaleDate)
  const prevSaleAmount = num(prevSale.Price)

  const confidence =
    propertyAddress && ownerName && marketValue ? 90 :
    propertyAddress && ownerName ? 75 :
    propertyAddress ? 55 : 30

  return {
    source:            'palm_beach_pa',
    sourceType:        'public',
    sourceDisplayName: 'Palm Beach County Property Appraiser',
    sourceUrl:         `${PBCPAO_BASE}/Property/Details?parcelId=${encodeURIComponent(folio)}`,
    confidence,

    folio,
    county:           'palm-beach',
    property_address: propertyAddress ?? undefined,
    city:             city ?? undefined,
    state:            'FL',
    zip:              zip ?? undefined,

    owner_name:      ownerName,
    mailing_address: mailingAddress,
    owner_state:     ownerState,
    owner_zip:       ownerZip,

    legal_desc:  legalDesc,
    subdivision,
    zoning,

    beds,
    baths,
    living_area:  livingArea,
    year_built:   yearBuilt,

    market_value:   marketValue,
    assessed_value: assessedValue,
    building_value: buildingValue,
    land_value:     landValue,
    tax_year:       taxYear,

    last_sale_date:   lastSaleDate,
    last_sale_amount: lastSaleAmount,
    prev_sale_date:   prevSaleDate,
    prev_sale_amount: prevSaleAmount,

    pa_url: `${PBCPAO_BASE}/Property/Details?parcelId=${encodeURIComponent(folio)}`,
    raw:    model,
  }
}

// ─── Public: search by folio ──────────────────────────────────────────────────

export async function searchByFolio(folio: string): Promise<PropertySourceResult | null> {
  const model = await fetchPropertyModel(folio)
  if (!model) {
    console.log('[PalmBeachPA] No data for folio:', folio)
    return null
  }
  return normalizeModel(model, folio)
}

// ─── Public: search by address ────────────────────────────────────────────────
// Address→PCN lookup requires maps.pbc.gov/giswebapi/anysearch (auth required, browser-only).
// Return null and let the enrich route fall back to REAPI.

export async function searchByAddress(
  address: string,
  _city?: string
): Promise<PropertySourceResult | null> {
  console.log('[PalmBeachPA] Address search not available (requires browser session) — REAPI fallback for:', address)
  return null
}
