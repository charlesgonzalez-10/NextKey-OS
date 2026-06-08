/**
 * Palm Beach County OR Index Adapter — Landmark Web Portal (HTTP scraping)
 *
 * Palm Beach County Clerk uses the Landmark ECF system, accessible at:
 *   https://mypalmbeachclerk.com/
 *
 * The OR document search is a two-step process:
 *   1. GET the search page to capture the session cookie and any hidden
 *      CSRF/verification tokens embedded in the form.
 *   2. POST a form-url-encoded search query with:
 *        - DocType (or DocTypeLow / DocTypeHigh): "LP" or "LIS PENDENS"
 *        - BeginRecordedDate / EndRecordedDate: yesterday MM/DD/YYYY
 *      Then parse the resulting HTML table (or JSON payload, depending on
 *      which endpoint version is active).
 *
 * NOTE: Web portal structures change without notice. If parsing breaks,
 *       the selectors in LANDMARK_SELECTORS below are the only things that
 *       need updating — the rest of the pipeline is untouched.
 *
 * cheerio is used for HTML parsing (already installed as a project dependency).
 */

import * as cheerio from 'cheerio'
import type { Element as DomElement } from 'domhandler'
import { isLisPendens } from './types'
import type { CountyAdapter, ORRecord, AdapterResult } from './types'

// ─── Endpoints ───────────────────────────────────────────────────────────────

const BASE_URL    = 'https://mypalmbeachclerk.com'
const SEARCH_PAGE = `${BASE_URL}/Official-Records/Search`
const SEARCH_POST = `${BASE_URL}/Official-Records/Search`

// ─── Browser-like headers to avoid basic bot blocks ──────────────────────────

const HEADERS: Record<string, string> = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control':   'max-age=0',
}

// ─── HTML table selectors ─────────────────────────────────────────────────────
// Update these if Landmark changes their DOM structure.

const LANDMARK_SELECTORS = {
  // The main results table that contains document rows
  resultsTable: 'table#searchResultsGrid, table.resultsGrid, #grdResults, table[id*="Result"]',
  // Token hidden input (for CSRF protection)
  csrfToken:    'input[name="__RequestVerificationToken"], input[name="_token"], input[name="csrfToken"]',
  // Session / view state
  viewState:    'input[name="__VIEWSTATE"]',
  antiForgery:  'input[name="__ANTIFORGERY"]',
}

// ─── Expected table column header → index mapping ────────────────────────────
// The Landmark OR search results table typically looks like:
//   CFN | Recorded | Type | Book | Page | Grantor | Grantee | Legal Description | Consideration

const COLUMN_PATTERNS = {
  cfn:           /^(CFN|INSTRUMENT|CLERK.*FILE|DOCUMENT\s*NO)/i,
  recorded_date: /^(RECORDED|REC.*DATE|DATE.*REC)/i,
  doc_type:      /^(DOC.*TYPE|TYPE)/i,
  grantor:       /^(GRANTOR|PLAINTIFF|PARTY\s*1)/i,
  grantee:       /^(GRANTEE|DEFENDANT|PARTY\s*2)/i,
  legal_desc:    /^(LEGAL|DESCRIPTION)/i,
  consideration: /^(CONSID|AMOUNT)/i,
} as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

function yesterdayMMDDYYYY(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const m   = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const y   = d.getFullYear()
  return `${m}/${day}/${y}`
}

function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function parseDateToISO(raw: string): string {
  if (!raw) return ''
  // MM/DD/YYYY
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim()
  return raw
}

/**
 * Detect column index by matching header text against known patterns.
 * Returns a map of { field: columnIndex } built from the table's <th> row.
 */
function detectColumns($: cheerio.CheerioAPI, headerRow: cheerio.Cheerio<DomElement>): Record<string, number> {
  const map: Record<string, number> = {}
  headerRow.find('th, td').each((i, el) => {
    const text = $(el).text().trim()
    for (const [field, pattern] of Object.entries(COLUMN_PATTERNS)) {
      if (pattern.test(text) && !(field in map)) {
        map[field] = i
      }
    }
  })
  return map
}

/** Extract text from a cell at a given column index, or '' if out of bounds */
function cell($: cheerio.CheerioAPI, row: cheerio.Cheerio<DomElement>, col: number | undefined): string {
  if (col === undefined) return ''
  return $(row.find('td').get(col) ?? '').text().trim()
}

/**
 * Try to parse Landmark's JSON endpoint first (newer versions of the portal
 * support XHR JSON responses when Accept: application/json is set).
 * Returns null if the response is HTML (falls through to HTML parsing).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryJSONEndpoint(yesterday: string): Promise<Record<string, any>[] | null> {
  try {
    const params = new URLSearchParams({
      DocTypeLow:          'LP',
      DocTypeHigh:         'LP',
      BeginRecordedDate:   yesterday,  // MM/DD/YYYY
      EndRecordedDate:     yesterday,
      SearchType:          'DocumentType',
    })

    const res = await fetch(`${SEARCH_POST}?${params}`, {
      method:  'GET',
      headers: { ...HEADERS, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' },
      signal:  AbortSignal.timeout(20_000),
    })

    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.includes('json')) return null

    const data = await res.json()
    if (Array.isArray(data)) return data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (Array.isArray((data as any)?.data)) return (data as any).data
    return null
  } catch {
    return null
  }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class PalmBeachORAdapter implements CountyAdapter {
  readonly county = 'palm-beach' as const

  async fetchYesterdaysRecords(): Promise<ORRecord[]> {
    const result = await this._fetch()
    return result.records
  }

  async fetch(): Promise<AdapterResult> {
    return this._fetch()
  }

  private async _fetch(): Promise<AdapterResult> {
    const yesterday    = yesterdayMMDDYYYY()
    const yesterdayISO = yesterdayMMDDYYYY().split('/').join('-').replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$1-$2')
    const source       = `PBC-Landmark:${yesterdayISO}`

    // ── Strategy 1: Try the JSON endpoint (faster, more reliable) ────────────
    const jsonRows = await tryJSONEndpoint(yesterday)
    if (jsonRows) {
      const records: ORRecord[] = []
      for (const row of jsonRows) {
        const docType  = String(row.DocType ?? row.doc_type ?? row.documentType ?? '').trim()
        if (!isLisPendens(docType)) continue

        const caseNum = String(row.CFN ?? row.cfn ?? row.InstrumentNumber ?? row.instrument_number ?? '').trim()
        if (!caseNum) continue

        const rawConsid = String(row.Consideration ?? row.consideration ?? '').replace(/[$,]/g, '')
        records.push({
          case_number:       caseNum,
          recording_date:    parseDateToISO(String(row.RecordedDate ?? row.recorded_date ?? row.date ?? '')),
          doc_type:          docType,
          plaintiff:         String(row.Grantor ?? row.grantor ?? row.GrantorName ?? '').trim(),
          defendant:         String(row.Grantee ?? row.grantee ?? row.GranteeName ?? '').trim(),
          legal_description: String(row.LegalDesc ?? row.legal_description ?? row.LegalDescription ?? '').trim() || undefined,
          consideration:     rawConsid ? parseFloat(rawConsid) : undefined,
          county:            'palm-beach',
          source_file:       source + ':json',
          raw:               row,
        })
      }
      console.log(`[Palm Beach OR] JSON endpoint: ${jsonRows.length} rows, ${records.length} LP filings`)
      return { county: 'palm-beach', records, fetched: jsonRows.length, filtered: records.length, source: source + ':json' }
    }

    // ── Strategy 2: HTML form POST ─────────────────────────────────────────

    // Step 1: GET the search page to capture session cookie + CSRF token
    let sessionCookie = ''
    let csrfToken     = ''
    let viewState     = ''

    try {
      const initRes = await fetch(SEARCH_PAGE, {
        method:  'GET',
        headers: HEADERS,
        signal:  AbortSignal.timeout(15_000),
      })

      // Extract Set-Cookie for session
      const setCookie = initRes.headers.get('set-cookie') ?? ''
      sessionCookie   = setCookie.split(';')[0] ?? ''

      const html = await initRes.text()
      const $    = cheerio.load(html)

      csrfToken = $(LANDMARK_SELECTORS.csrfToken).val() as string ?? ''
      viewState = $(LANDMARK_SELECTORS.viewState).val() as string ?? ''
    } catch (err) {
      const msg = `Failed to initialise session: ${String(err)}`
      console.error(`[Palm Beach OR] ${msg}`)
      return { county: 'palm-beach', records: [], fetched: 0, filtered: 0, source, error: msg }
    }

    // Step 2: POST the search form
    const formBody = new URLSearchParams({
      DocTypeLow:                   'LP',
      DocTypeHigh:                  'LP',
      BeginRecordedDate:            yesterday,
      EndRecordedDate:              yesterday,
      SearchType:                   'DocumentType',
      __RequestVerificationToken:   csrfToken,
      __VIEWSTATE:                  viewState,
    })

    let htmlBody = ''
    try {
      const postRes = await fetch(SEARCH_POST, {
        method: 'POST',
        headers: {
          ...HEADERS,
          'Content-Type':  'application/x-www-form-urlencoded',
          'Referer':        SEARCH_PAGE,
          ...(sessionCookie ? { 'Cookie': sessionCookie } : {}),
        },
        body:   formBody.toString(),
        signal: AbortSignal.timeout(30_000),
      })

      if (!postRes.ok) {
        const msg = `POST HTTP ${postRes.status}`
        console.error(`[Palm Beach OR] ${msg}`)
        return { county: 'palm-beach', records: [], fetched: 0, filtered: 0, source, error: msg }
      }
      htmlBody = await postRes.text()
    } catch (err) {
      const msg = `POST request failed: ${String(err)}`
      console.error(`[Palm Beach OR] ${msg}`)
      return { county: 'palm-beach', records: [], fetched: 0, filtered: 0, source, error: msg }
    }

    // Step 3: Parse HTML results table
    const $       = cheerio.load(htmlBody)
    const table   = $(LANDMARK_SELECTORS.resultsTable).first()

    if (!table.length) {
      // No table found — either 0 results or the selector needs updating
      const noResults = htmlBody.toLowerCase().includes('no records') ||
                        htmlBody.toLowerCase().includes('no results') ||
                        htmlBody.toLowerCase().includes('0 records')
      if (noResults) {
        console.log(`[Palm Beach OR] No LP filings found for ${yesterday}`)
        return { county: 'palm-beach', records: [], fetched: 0, filtered: 0, source }
      }
      const msg = 'Results table not found in HTML — selector may need updating'
      console.warn(`[Palm Beach OR] ${msg}`)
      return { county: 'palm-beach', records: [], fetched: 0, filtered: 0, source, error: msg }
    }

    const rows = table.find('tbody tr, tr:not(:first-child)')
    const headerRow = table.find('thead tr, tr:first-child')
    const colMap = detectColumns($, headerRow)

    const records: ORRecord[] = []
    let fetched = 0

    rows.each((_, el) => {
      const row  = $(el)
      const cols = row.find('td')
      if (!cols.length) return   // skip header / empty rows
      fetched++

      const docType = cell($, row, colMap.doc_type)
      if (!isLisPendens(docType)) return

      const caseNum = cell($, row, colMap.cfn)
      if (!caseNum) return

      const rawConsid = cell($, row, colMap.consideration).replace(/[$,]/g, '')
      const consid    = rawConsid ? parseFloat(rawConsid) : undefined

      records.push({
        case_number:       caseNum,
        recording_date:    parseDateToISO(cell($, row, colMap.recorded_date)),
        doc_type:          docType,
        plaintiff:         cell($, row, colMap.grantor),
        defendant:         cell($, row, colMap.grantee),
        legal_description: cell($, row, colMap.legal_desc) || undefined,
        consideration:     isNaN(consid!) ? undefined : consid,
        county:            'palm-beach',
        source_file:       source + ':html',
        raw:               cols.toArray().map(c => $(c).text().trim()),
      })
    })

    console.log(`[Palm Beach OR] HTML: ${fetched} rows total, ${records.length} LP filings`)
    return { county: 'palm-beach', records, fetched, filtered: records.length, source: source + ':html' }
  }
}
