/**
 * Lee County Property Appraiser (LEEPA) adapter.
 * Website: https://www.leepa.org
 *
 * Three-step extraction:
 *
 *   1. GET /Search/PropertySearch.aspx  → ASP.NET session cookie + VIEWSTATE
 *   2. POST /Search/PropertySearch.aspx → search results HTML
 *      (yields STRAP, FolioID, owner, mailing/site address, legal)
 *   3a. GET DisplayParcel.aspx?FolioID=X&historyDetails=True   → valuations
 *   3b. GET DisplayParcel.aspx?FolioID=X&PropertyDetailsCurrent=True → building details
 *       (3a and 3b fetched in parallel; no session state required)
 *
 * Data available: STRAP, FolioID, owner name, mailing address, site address,
 *   legal description, market/assessed/land/taxable values, beds, baths,
 *   year built, living area (sum of heated subareas).
 */

import type { PropertySourceResult } from './types'

const LEEPA_BASE = 'https://www.leepa.org'
const FETCH_TIMEOUT = 20_000

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ─── Session bootstrap ────────────────────────────────────────────────────────

interface LeeSession {
  cookie:             string
  viewstate:          string
  viewstategenerator: string
}

async function getSession(): Promise<LeeSession | null> {
  try {
    const res = await fetch(`${LEEPA_BASE}/Search/PropertySearch.aspx`, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return null
    const html = await res.text()
    return {
      cookie:             extractSetCookies(res),
      viewstate:          extractHiddenField(html, '__VIEWSTATE'),
      viewstategenerator: extractHiddenField(html, '__VIEWSTATEGENERATOR'),
    }
  } catch {
    return null
  }
}

function extractSetCookies(res: Response): string {
  return [...res.headers.entries()]
    .filter(([k]) => k === 'set-cookie')
    .map(([, v]) => v.split(';')[0])
    .join('; ')
}

function extractHiddenField(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = html.match(new RegExp(`name="${escaped}"[^>]*value="([^"]*)"`, 'i'))
  return m ? m[1] : ''
}

// ─── POST search (address or folio/STRAP) ────────────────────────────────────

async function postSearch(
  session: LeeSession,
  mode: 'address' | 'folio',
  query: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    __EVENTTARGET: '', __EVENTARGUMENT: '', __LASTFOCUS: '',
    __VIEWSTATE:          session.viewstate,
    __VIEWSTATEGENERATOR: session.viewstategenerator,
    'ctl00$BodyContentPlaceHolder$WebTab1.i': '0',
    'ctl00$BodyContentPlaceHolder$WebTab1$tmpl0$SubmitPropertySearch': 'Search',
  })

  if (mode === 'address') {
    body.set('ctl00$BodyContentPlaceHolder$WebTab1$tmpl0$SearchSouceGroup', 'Situs')
    body.set('ctl00$BodyContentPlaceHolder$WebTab1$tmpl0$AddressTextBox', query)
  } else {
    body.set('ctl00$BodyContentPlaceHolder$WebTab1$tmpl0$FolioTextBox', query)
  }

  try {
    const res = await fetch(`${LEEPA_BASE}/Search/PropertySearch.aspx`, {
      method: 'POST',
      headers: {
        'User-Agent': BROWSER_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': session.cookie,
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: 'follow',
    })
    if (!res.ok) return null
    return res.text()
  } catch {
    return null
  }
}

// ─── Parse search results HTML ────────────────────────────────────────────────
//
// Each result row in the table has three columns:
//
//   Col 1 — STRAP/FolioID (.parentContainer > .item × 2)
//   Col 2 — Owner + Mailing  (.bold for name, plain <div> for street + city/state/zip)
//   Col 3 — Site address + Legal  (two .itemAddAndLegal blocks)

interface LeeRowData {
  strap:           string | null
  folioId:         string | null
  ownerName:       string | null
  mailingStreet:   string | null
  mailingCityLine: string | null  // "NAPLES FL 34109"
  siteStreet:      string | null  // "1122 COVE ST E"
  siteCityLine:    string | null  // "LEHIGH ACRES FL 33974"
  legalDesc:       string | null
}

function parseSearchResultsRow(html: string): LeeRowData | null {
  // Anchor on the first STRAP pattern — all other data follows it
  const strapM = html.match(/(\d{2}-\d{2}-\d{2}-[A-Z0-9]\d-\d{5}\.\d{4})/)
  if (!strapM) return null

  // Work on the HTML from the STRAP onward (covers the row fully)
  const chunk = html.slice(strapM.index!)

  // FolioID: the second .item div immediately after STRAP
  const folioItemM = chunk.match(/<div[^>]+class="item"[^>]*>\s*(\d{8})\s*<\/div>/)
  const folioId = folioItemM ? folioItemM[1].trim() : null

  // Owner name: first .bold div with non-empty content
  const boldM = chunk.match(/<div[^>]+class="bold"[^>]*>([^<]+)<\/div>/)
  const ownerName = boldM ? boldM[1].trim() : null

  // Mailing address: plain <div>text</div> after the owner bold, before itemAddAndLegal
  const itemAddIdx = chunk.indexOf('itemAddAndLegal')
  const ownerSection = itemAddIdx >= 0 ? chunk.slice(0, itemAddIdx) : chunk
  // Match only plain <div>…</div> (no attributes)
  const plainDivs = [...ownerSection.matchAll(/<div>([^<\n]+)<\/div>/g)]
    .map(m => m[1].trim())
    .filter(v => v.length > 0)
  // plainDivs = ["6820 DANIELS RD", "NAPLES FL 34109"]

  const mailingStreet   = plainDivs[0] ?? null
  const mailingCityLine = plainDivs[1] ?? null

  // Site + Legal: two .itemAddAndLegal blocks
  // Each has <div style="margin-left: 2px;">…</div> children
  const itemAddBlocks = [...chunk.matchAll(/<div[^>]+class="itemAddAndLegal"[^>]*>([\s\S]*?)(?=<div[^>]+class="itemAddAndLegal"|<\/div>\s*<\/div>\s*<\/td>)/g)]
    .map(m => m[1])

  function marginDivTexts(section: string): string[] {
    return [...section.matchAll(/<div[^>]*margin-left[^>]*>([^<]+)<\/div>/g)]
      .map(m => m[1].trim())
      .filter(v => v.length > 0)
  }

  const siteTexts  = marginDivTexts(itemAddBlocks[0] ?? '')
  const legalTexts = marginDivTexts(itemAddBlocks[1] ?? '')

  const siteStreet   = siteTexts[0] ?? null
  const siteCityLine = siteTexts[1] ?? null
  const legalDesc    = legalTexts[0]?.replace(/\s+/g, ' ').trim() ?? null

  return {
    strap:    strapM[1],
    folioId,
    ownerName,
    mailingStreet,
    mailingCityLine,
    siteStreet,
    siteCityLine,
    legalDesc,
  }
}

// ─── Detail page: value history ───────────────────────────────────────────────
//
// GET /Display/DisplayParcel.aspx?FolioID=X&historyDetails=True
//
// The #PropertyValueHistory section contains a <table id="valueGrid"> with one
// row per tax year (most recent first). Columns (0-indexed):
//   0: TRIM Notices link
//   1: Tax Year label ("2025 (Final Value)")
//   2: Just value (market/just)
//   3: Land value
//   4: Market Assessed value (before Save Our Homes cap)
//   5: Capped Assessed value
//   6: Exemptions
//   7: Classified Use
//   8: Taxable value

interface LeeValueData {
  taxYear:       number | null
  marketValue:   number | null  // Just value
  landValue:     number | null
  assessedValue: number | null  // Capped Assessed (after SOH cap)
  taxableValue:  number | null
}

function parseMoney(s: string | undefined): number | null {
  if (!s) return null
  const n = parseInt(s.replace(/[,$]/g, ''), 10)
  return isNaN(n) ? null : n
}

async function fetchValueHistory(folioId: string): Promise<LeeValueData | null> {
  try {
    const res = await fetch(
      `${LEEPA_BASE}/Display/DisplayParcel.aspx?FolioID=${encodeURIComponent(folioId)}&historyDetails=True`,
      {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      },
    )
    if (!res.ok) return null
    const html = await res.text()

    // Find the valueGrid table
    const gridIdx = html.indexOf('id="valueGrid"')
    if (gridIdx < 0) return null

    // Grab the table body (first two <tr> blocks: header + first data row)
    const tableChunk = html.slice(gridIdx, gridIdx + 4000)

    // Extract all <tr> blocks within the table
    const rows = [...tableChunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1])
    // rows[0] = header, rows[1] = first data row (most recent year)
    const dataRow = rows[1]
    if (!dataRow) return null

    // Extract cell text values from <td>
    const cells = [...dataRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())

    // cells: [trimLink, taxYearLabel, just, land, marketAssessed, cappedAssessed, exemptions, classifiedUse, taxable]
    const taxYearM = cells[1]?.match(/\b(\d{4})\b/)
    const taxYear  = taxYearM ? parseInt(taxYearM[1], 10) : null

    return {
      taxYear,
      marketValue:   parseMoney(cells[2]),
      landValue:     parseMoney(cells[3]),
      assessedValue: parseMoney(cells[5]),  // Capped Assessed (what FL uses for tax bills)
      taxableValue:  parseMoney(cells[8]),
    }
  } catch {
    return null
  }
}

// ─── Detail page: building characteristics ────────────────────────────────────
//
// GET /Display/DisplayParcel.aspx?FolioID=X&PropertyDetailsCurrent=True
//
// The #PropertyDetailsCurrent section contains:
//
//   Building Characteristics table:
//     Row with headers: Improvement Type | Model Type | Stories | Living Units
//     Row with values:  "104 - Key West" | "1 - SINGLE FAMILY..." | "1.5" | "1"
//     Row with headers: Bedrooms | Bathrooms | Year Built | Effective Year Built
//     Row with values:  "2" | "2.0" | "1979" | "1996"
//
//   Building Subareas table:
//     Row with headers: Description | Heated / Under Air | Area (Sq Ft)
//     Data rows: "<subarea name>" | "Y"/"N" | "<sq ft>"
//     (living area = sum of sq ft where Heated/Under Air = "Y")

interface LeeBuildingData {
  beds:         number | null
  baths:        number | null
  yearBuilt:    number | null
  livingArea:   number | null  // sum of heated subareas
  buildingArea: number | null  // sum of all subareas
  stories:      number | null
}

async function fetchBuildingDetails(folioId: string): Promise<LeeBuildingData | null> {
  try {
    const res = await fetch(
      `${LEEPA_BASE}/Display/DisplayParcel.aspx?FolioID=${encodeURIComponent(folioId)}&PropertyDetailsCurrent=True`,
      {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      },
    )
    if (!res.ok) return null
    const html = await res.text()

    // Find "Bedrooms" heading — anchors us in the Building Characteristics table
    const bedroomThIdx = html.indexOf('>Bedrooms<')
    if (bedroomThIdx < 0) return null  // no buildings (vacant land)

    // The data row immediately follows the header row containing "Bedrooms"
    const afterBedroomHeader = html.slice(bedroomThIdx)
    const firstRowM = afterBedroomHeader.match(/<\/tr>\s*<tr[^>]*>([\s\S]*?)<\/tr>/)
    if (!firstRowM) return null

    const bldgCells = [...firstRowM[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)]
      .map(m => m[1].trim())
    // bldgCells: [beds, baths, yearBuilt, effectiveYearBuilt]

    const beds      = bldgCells[0] ? parseInt(bldgCells[0], 10) : null
    const baths     = bldgCells[1] ? parseFloat(bldgCells[1]) : null
    const yearBuilt = bldgCells[2] ? parseInt(bldgCells[2], 10) : null

    // Find stories — in the row before Bedrooms (Improvement Type row)
    const storiesHeaderIdx = html.lastIndexOf('>Stories<', bedroomThIdx)
    let stories: number | null = null
    if (storiesHeaderIdx >= 0) {
      const afterStoriesHeader = html.slice(storiesHeaderIdx)
      const storiesRowM = afterStoriesHeader.match(/<\/tr>\s*<tr[^>]*>([\s\S]*?)<\/tr>/)
      if (storiesRowM) {
        const stCells = [...storiesRowM[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1].trim())
        // stCells: [improvementType, modelType, stories, livingUnits]
        stories = stCells[2] ? parseFloat(stCells[2]) : null
      }
    }

    // Parse subareas for living area calculation
    // "Heated / Under Air" header anchors the subareas table
    const heatedIdx = html.indexOf('Heated / Under Air', bedroomThIdx)
    let livingArea   = 0
    let buildingArea = 0
    if (heatedIdx >= 0) {
      // Grab everything after this header, up to ~3000 chars (covers all subareas)
      const subareaChunk = html.slice(heatedIdx, heatedIdx + 3000)
      // Each data row: three cells — description, Y/N, sqft
      const subareaRows = [...subareaChunk.matchAll(/<\/tr>\s*<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      for (const rowM of subareaRows) {
        const cells = [...rowM[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
          .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim())
        if (cells.length < 3) continue
        // cells: [description (colspan 2 = two td hits), heated, sqft]
        // The table uses colspan so description appears as multiple cells
        // Find the Y/N cell and sqft cell
        const heated = cells.find(c => c === 'Y' || c === 'N')
        const sqftStr = cells[cells.length - 1]
        const sqft   = parseInt(sqftStr?.replace(/[,\s]/g, ''), 10)
        if (isNaN(sqft) || sqft <= 0) continue
        buildingArea += sqft
        if (heated === 'Y') livingArea += sqft
      }
    }

    return {
      beds:         isNaN(beds ?? NaN)      ? null : beds,
      baths:        isNaN(baths ?? NaN)     ? null : baths,
      yearBuilt:    isNaN(yearBuilt ?? NaN) ? null : yearBuilt,
      stories:      isNaN(stories ?? NaN)   ? null : stories,
      livingArea:   livingArea   > 0 ? livingArea   : null,
      buildingArea: buildingArea > 0 ? buildingArea : null,
    }
  } catch {
    return null
  }
}

// ─── Normalize LeeRowData → PropertySourceResult ──────────────────────────────

function parseStateZip(cityLine: string | null): { city: string | null; state: string; zip: string | null } {
  if (!cityLine) return { city: null, state: 'FL', zip: null }
  // "LEHIGH ACRES FL 33974" or "NAPLES FL 34109"
  const m = cityLine.match(/^(.*?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/)
  if (!m) return { city: cityLine, state: 'FL', zip: null }
  return { city: m[1].trim() || null, state: m[2], zip: m[3].split('-')[0] }
}

function normalizeRow(
  row:      LeeRowData,
  input:    string,
  values?:  LeeValueData  | null,
  building?: LeeBuildingData | null,
): PropertySourceResult {
  const folio   = row.strap ?? row.folioId ?? input
  const folioId = row.folioId

  const site    = parseStateZip(row.siteCityLine)
  const mailing = parseStateZip(row.mailingCityLine)

  const propertyAddress = row.siteStreet
  const city            = site.city
  const zip             = site.zip
  const state           = site.state

  const ownerName      = row.ownerName
  const mailingAddress = [row.mailingStreet, row.mailingCityLine].filter(Boolean).join(', ') || null
  const ownerState     = mailing.state !== 'FL' || row.mailingCityLine ? mailing.state : null
  const ownerZip       = mailing.zip

  const absentee = Boolean(
    propertyAddress && row.mailingStreet &&
    !row.mailingStreet.toUpperCase().startsWith(propertyAddress.toUpperCase().slice(0, 6)),
  )

  const hasValues   = values   && (values.marketValue   != null || values.assessedValue != null)
  const hasBuilding = building && (building.beds         != null || building.yearBuilt   != null)

  const confidence =
    propertyAddress && ownerName && hasValues && hasBuilding ? 90 :
    propertyAddress && ownerName && hasValues               ? 80 :
    propertyAddress && ownerName                            ? 65 :
    propertyAddress                                         ? 50 :
    ownerName                                               ? 40 : 30

  return {
    source:            'lee_pa',
    sourceType:        'public',
    sourceDisplayName: 'Lee County Property Appraiser',
    sourceUrl:         folioId
      ? `${LEEPA_BASE}/Display/DisplayParcel.aspx?FolioID=${folioId}`
      : `${LEEPA_BASE}/Search/PropertySearch.aspx`,
    confidence,

    folio,
    county:           'lee',
    property_address: propertyAddress ?? undefined,
    city:             city ?? undefined,
    state,
    zip:              zip ?? undefined,

    owner_name:      ownerName,
    mailing_address: mailingAddress,
    owner_state:     ownerState,
    owner_zip:       ownerZip,

    absentee_owner: absentee,

    legal_desc: row.legalDesc,

    // Valuation (from historyDetails page)
    ...(values ? {
      market_value:   values.marketValue,
      land_value:     values.landValue,
      assessed_value: values.assessedValue,
      taxable_value:  values.taxableValue,
      tax_year:       values.taxYear,
    } : {}),

    // Building (from PropertyDetailsCurrent page)
    ...(building ? {
      beds:         building.beds,
      baths:        building.baths,
      year_built:   building.yearBuilt,
      living_area:  building.livingArea,
      building_area: building.buildingArea,
      stories:      building.stories,
    } : {}),

    pa_url: folioId
      ? `${LEEPA_BASE}/Display/DisplayParcel.aspx?FolioID=${folioId}`
      : null,

    raw: { ...row, values, building },
  }
}

// ─── Street extraction for address search ─────────────────────────────────────

function extractStreet(raw: string): string {
  return raw
    .split(',')[0]
    .trim()
    .replace(/\s+FL\s+\d{5}(-\d{4})?\s*$/i, '')
    .trim()
    .toUpperCase()
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/** Extract "SS-TT-RR" section-township-range prefix from a STRAP. */
function strapPrefix(s: string): string {
  return s.split('-').slice(0, 3).join('-')
}

// ─── Enrich with detail-page data (parallel, non-blocking) ───────────────────

async function enrichWithDetails(
  row:   LeeRowData,
  input: string,
): Promise<PropertySourceResult> {
  const folioId = row.folioId
  if (!folioId) return normalizeRow(row, input)

  const [values, building] = await Promise.allSettled([
    fetchValueHistory(folioId),
    fetchBuildingDetails(folioId),
  ])

  const v = values.status   === 'fulfilled' ? values.value   : null
  const b = building.status === 'fulfilled' ? building.value : null

  console.log('[LeePA] detail enrichment:', {
    folioId,
    values: v   ? { marketValue: v.marketValue, assessedValue: v.assessedValue, taxYear: v.taxYear } : null,
    building: b ? { beds: b.beds, baths: b.baths, yearBuilt: b.yearBuilt, livingArea: b.livingArea } : null,
  })

  return normalizeRow(row, input, v, b)
}

// ─── Public: search by folio ──────────────────────────────────────────────────

export async function searchByFolio(folio: string): Promise<PropertySourceResult | null> {
  const f = folio.trim()
  const isStrap   = /^\d{2}-\d{2}-\d{2}-[A-Z0-9]\d-\d{5}\.\d{4}$/.test(f)
  const isFolioId = /^\d{8}$/.test(f)

  if (!isStrap && !isFolioId) {
    console.log('[LeePA] searchByFolio: unrecognized format:', f)
    return null
  }

  try {
    const session = await getSession()
    if (!session) { console.log('[LeePA] getSession failed'); return null }

    const html = await postSearch(session, 'folio', f)
    if (!html) { console.log('[LeePA] folio search POST failed for:', f); return null }

    const row = parseSearchResultsRow(html)
    if (!row) {
      console.log('[LeePA] searchByFolio: no result row for:', f)
      return null
    }

    // Validate the result is actually the property we searched for.
    // Lee PA's FolioTextBox returns the first DB entry when the input doesn't
    // match anything — check section-township-range prefix matches for STRAPs,
    // or FolioID equality for numeric IDs.
    if (isStrap && row.strap) {
      if (strapPrefix(row.strap) !== strapPrefix(f)) {
        console.log('[LeePA] searchByFolio: STRAP prefix mismatch, input:', f, 'returned:', row.strap, '— returning null')
        return null
      }
    }
    if (isFolioId && row.folioId && row.folioId !== f) {
      console.log('[LeePA] searchByFolio: FolioID mismatch, input:', f, 'returned:', row.folioId, '— returning null')
      return null
    }

    console.log('[LeePA] searchByFolio result:', { strap: row.strap, folioId: row.folioId, owner: row.ownerName })
    return enrichWithDetails(row, f)
  } catch (err) {
    console.warn('[LeePA] searchByFolio error:', err)
    return null
  }
}

// ─── Public: search by address ────────────────────────────────────────────────

export async function searchByAddress(
  address: string,
  _city?: string,
): Promise<PropertySourceResult | null> {
  const street = extractStreet(address)
  console.log('[LeePA] searchByAddress:', address, '→', street)

  try {
    const session = await getSession()
    if (!session) { console.log('[LeePA] getSession failed'); return null }

    const html = await postSearch(session, 'address', street)
    if (!html) { console.log('[LeePA] address search POST failed for:', street); return null }

    const row = parseSearchResultsRow(html)
    console.log('[LeePA] searchByAddress result:', row
      ? { strap: row.strap, folioId: row.folioId, owner: row.ownerName, site: row.siteStreet }
      : 'no row found')
    if (!row) return null

    return enrichWithDetails(row, street)
  } catch (err) {
    console.warn('[LeePA] searchByAddress error:', err)
    return null
  }
}
