/**
 * Lee County Property Appraiser (LEEPA) adapter.
 * Website: https://www.leepa.org
 *
 * Two-step extraction — no third request needed:
 *
 *   1. GET /Search/PropertySearch.aspx  → ASP.NET session cookie + VIEWSTATE
 *   2. POST /Search/PropertySearch.aspx → search results HTML
 *
 * All data is parsed directly from the search results page.
 * The detail page (DisplayParcel.aspx) requires server-side session state to
 * populate data, which is not reliably preserved across serverless invocations.
 * Everything we can extract without JS is present in the results row itself.
 *
 * Data available: STRAP, FolioID, owner name, mailing address, site address,
 *   legal description.
 * Data NOT available: valuations, taxes, building details (beds/baths/sqft/year
 *   built) — these require JavaScript execution on the detail page.
 *   → REAPI handles them as the paid fallback.
 */

import type { PropertySourceResult } from './types'

const LEEPA_BASE = 'https://www.leepa.org'
const FETCH_TIMEOUT = 20_000

// ─── Session bootstrap ────────────────────────────────────────────────────────

interface LeeSession {
  cookie:             string
  viewstate:          string
  viewstategenerator: string
}

async function getSession(): Promise<LeeSession | null> {
  try {
    const res = await fetch(`${LEEPA_BASE}/Search/PropertySearch.aspx`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
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
        'User-Agent': 'Mozilla/5.0',
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

  const siteStreet  = siteTexts[0] ?? null
  const siteCityLine = siteTexts[1] ?? null
  const legalDesc   = legalTexts[0]?.replace(/\s+/g, ' ').trim() ?? null

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

// ─── Normalize LeeRowData → PropertySourceResult ──────────────────────────────

function parseStateZip(cityLine: string | null): { city: string | null; state: string; zip: string | null } {
  if (!cityLine) return { city: null, state: 'FL', zip: null }
  // "LEHIGH ACRES FL 33974" or "NAPLES FL 34109"
  const m = cityLine.match(/^(.*?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/)
  if (!m) return { city: cityLine, state: 'FL', zip: null }
  return { city: m[1].trim() || null, state: m[2], zip: m[3].split('-')[0] }
}

function normalizeRow(row: LeeRowData, requestedInput: string): PropertySourceResult {
  const folio   = row.strap ?? row.folioId ?? requestedInput
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

  const confidence =
    propertyAddress && ownerName ? 65 :
    propertyAddress ? 50 :
    ownerName ? 40 : 30

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

    pa_url: folioId
      ? `${LEEPA_BASE}/Display/DisplayParcel.aspx?FolioID=${folioId}`
      : null,

    raw: row,
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
    return normalizeRow(row, f)
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
    console.log('[LeePA] searchByAddress result:', row ? { strap: row.strap, folioId: row.folioId, owner: row.ownerName, site: row.siteStreet } : 'no row found')
    if (!row) return null

    return normalizeRow(row, street)
  } catch (err) {
    console.warn('[LeePA] searchByAddress error:', err)
    return null
  }
}
