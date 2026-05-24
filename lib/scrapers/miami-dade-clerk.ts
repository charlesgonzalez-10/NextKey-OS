/**
 * Miami-Dade County Clerk — Official Records Search
 *
 * System: Tyler Technologies "Laredo" OfficialRecords React SPA
 * Base:   https://onlineservices.miamidadeclerk.gov/officialrecords
 *
 * Flow:
 *   1. Solve reCAPTCHA v3 (sitekey hard-coded, confirmed from bundle)
 *   2. POST /api/home/standardsearch  → { isValidSearch, qs }
 *   3. GET  /api/home/getAdvancedRecords?qs=<qs> → array of records
 */

import type { ClerkRecord } from './types'
import { parseDate, today, getWeekAgo, toFormDate } from './utils'
import { solveCaptcha } from './captcha'

const BASE      = 'https://onlineservices.miamidadeclerk.gov/officialrecords'
const PAGE_URL  = `${BASE}/`
const SITE_KEY  = '6LfI8ikaAAAAAH0qlQMApskMGd1U6EqDyniH5t0x'  // v3, confirmed

const HEADERS = {
  'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':       'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin':       'https://onlineservices.miamidadeclerk.gov',
  'Referer':      `${BASE}/`,
}


export async function scrapeMiamiDadeClerk(): Promise<ClerkRecord[]> {
  const apiKey = process.env.TWOCAPTCHA_API_KEY
  if (!apiKey) throw new Error('TWOCAPTCHA_API_KEY not set')

  const fromDate = toFormDate(getWeekAgo())
  const toDate   = toFormDate(today())

  console.log(`[miami-dade] Solving reCAPTCHA v3 for date range ${fromDate}–${toDate}…`)
  const captchaToken = await solveCaptcha({
    apiKey,
    siteKey:  SITE_KEY,
    pageUrl:  PAGE_URL,
    type:     'v3',
    action:   'officialrecords',
    minScore: 0.3,
  })

  // ── Step 1: standardsearch → get QS token ──────────────────────────────────
  // Confirmed from JS bundle: params go in URL query string, body is empty,
  // method is POST, x-recaptcha-token header is required.
  const searchParams = new URLSearchParams({
    partyName:    '',
    dateRangeFrom: fromDate,
    dateRangeTo:   toDate,
    documentType:  'LIS PENDENS',
    searchT:       'LIS PENDENS',
    firstQuery:    'true',
    searchtype:    'INSTRUMENT',
  })

  const searchRes = await fetch(`${BASE}/api/home/standardsearch?${searchParams}`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type':      'application/json',
      'x-recaptcha-token': captchaToken,
    },
    signal: AbortSignal.timeout(30_000),
  })

  const searchText = await searchRes.text()
  console.log(`[miami-dade] standardsearch status=${searchRes.status} body=${searchText.slice(0, 300)}`)

  if (!searchRes.ok) {
    throw new Error(`Miami-Dade standardsearch failed: ${searchRes.status} ${searchText.slice(0, 300)}`)
  }

  let searchData: { isValidSearch?: boolean; qs: string | null }
  try {
    searchData = JSON.parse(searchText)
  } catch {
    throw new Error(`Miami-Dade standardsearch — invalid JSON: ${searchText.slice(0, 300)}`)
  }

  if (!searchData.qs) {
    // Try alternate searchtype values if first attempt yields no QS
    console.log('[miami-dade] No QS with INSTRUMENT searchtype, retrying with ADVANCED…')
    const retryParams = new URLSearchParams({ ...Object.fromEntries(searchParams), searchtype: 'ADVANCED' })
    const retryRes  = await fetch(`${BASE}/api/home/standardsearch?${retryParams}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'x-recaptcha-token': captchaToken },
      signal: AbortSignal.timeout(30_000),
    })
    const retryText = await retryRes.text()
    console.log(`[miami-dade] retry status=${retryRes.status} body=${retryText.slice(0, 300)}`)
    try { searchData = JSON.parse(retryText) } catch { /* keep original */ }
  }

  if (!searchData.qs) {
    throw new Error(`Miami-Dade standardsearch returned no QS token. body=${searchText.slice(0, 300)}`)
  }

  const qs = searchData.qs
  console.log(`[miami-dade] Got QS token (len=${qs.length}), fetching records…`)

  // ── Step 2: getStandardRecords → actual records ───────────────────────────
  // Confirmed from JS bundle: GET /api/SearchResults/getStandardRecords?qs=<qs>
  // NOTE: QS token must NOT be URL-encoded — the server rejects encoded values with 404.
  // Raw QS string passed directly in query param.
  const recordsRes  = await fetch(
    `${BASE}/api/SearchResults/getStandardRecords?qs=${qs}`,
    { headers: { ...HEADERS }, signal: AbortSignal.timeout(30_000) }
  )
  const recordsText = await recordsRes.text()
  console.log(`[miami-dade] getStandardRecords → ${recordsRes.status}, body=${recordsText.slice(0, 400)}`)

  let rawRecords: Record<string, unknown>[] = []

  if (recordsRes.ok) {
    try {
      const data = JSON.parse(recordsText)
      rawRecords = Array.isArray(data)
        ? data
        : (data.records || data.results || data.data || data.items || data.Rows || [])
    } catch (e) {
      console.log(`[miami-dade] getStandardRecords JSON parse error: ${e}`)
    }
  }

  if (rawRecords.length === 0) {
    console.log('[miami-dade] No records found — check API response logs above')
    return []
  }

  // ── Step 4: Normalise records ─────────────────────────────────────────────
  const records: ClerkRecord[] = rawRecords.map((r, idx) => {
    const caseNum  = String(r.instrumentNumber || r.caseNumber || r.InstrumentNumber || r.CaseNumber || `MD-${idx}`)
    const fileDate = parseDate(String(r.recordedDate || r.fileDate || r.RecordedDate || r.FiledDate || '')) || today()

    // Grantor = mortgagor/borrower, Grantee = lender/plaintiff
    const grantors   = (r.grantorNames || r.grantors || r.GrantorNames || []) as string[]
    const grantees   = (r.granteeNames || r.grantees || r.GranteeNames || []) as string[]
    const mortgagor  = Array.isArray(grantors) ? grantors.join('; ') : String(grantors || '')
    const plaintiff  = Array.isArray(grantees) ? grantees.join('; ') : String(grantees || '')

    const amount = parseFloat(String(r.consideration || r.amount || r.Amount || '0')) || 0

    return {
      case_number:        caseNum,
      file_date:          fileDate,
      plaintiff:          plaintiff,
      mortgagor:          mortgagor,
      foreclosure_amount: amount,
      lender_name:        plaintiff,
      foreclosure_type:   'P' as const,
      multiple_liens:     false,
      county:             'miami-dade' as const,
    }
  })

  console.log(`[miami-dade] Extracted ${records.length} lis pendens`)
  return records
}
