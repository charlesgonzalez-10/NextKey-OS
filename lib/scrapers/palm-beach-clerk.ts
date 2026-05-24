/**
 * Palm Beach County Clerk — Official Records (eRecords)
 *
 * System: Tyler Technologies eRecords (erec.mypalmbeachclerk.com)
 * Correct domain confirmed: erec.mypalmbeachclerk.com
 *
 * Flow (confirmed via live testing):
 *   1. POST /Search/SetDisclaimer  { isAccepted: true }  → sets disclaimer cookie
 *   2. GET  /Search                                       → get dynamic data-sitekey
 *   3. Solve reCAPTCHA v2 with that sitekey
 *   4. POST /Search/DocumentTypeSearch
 *        { doctype: "20", beginDate: "MM/DD/YYYY", endDate: "MM/DD/YYYY",
 *          recordCount: 300, "g-recaptcha-response": "<token>" }
 *   5. Parse JSON response → array of lis pendens instrument records
 *
 * Document type 20 = Lis Pendens (LP) — confirmed via county doc-type list
 */

import * as cheerio from 'cheerio'
import type { ClerkRecord } from './types'
import { parseDate, today, getWeekAgo, toFormDate } from './utils'
import { solveCaptcha } from './captcha'

const BASE     = 'https://erec.mypalmbeachclerk.com'
const PAGE_URL = `${BASE}/Search`

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin':          BASE,
  'Referer':         `${BASE}/Search`,
}

// Extract all Set-Cookie values from a Response into a single Cookie string
function extractCookies(res: Response): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setCookieFn = (res.headers as any).getSetCookie
  const raw: string[] = typeof setCookieFn === 'function'
    ? setCookieFn.call(res.headers)
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
  return raw.map(c => c.split(';')[0]).join('; ')
}

function mergeCookies(existing: string, next: string): string {
  if (!next) return existing
  if (!existing) return next
  // Merge by key, later values win
  const map = new Map<string, string>()
  for (const pair of [...existing.split('; '), ...next.split('; ')]) {
    const [k, ...rest] = pair.split('=')
    if (k) map.set(k.trim(), rest.join('='))
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

export async function scrapePalmBeachClerk(): Promise<ClerkRecord[]> {
  const apiKey = process.env.TWOCAPTCHA_API_KEY
  if (!apiKey) throw new Error('TWOCAPTCHA_API_KEY not set')

  // Retry up to 2 times on ERROR_CAPTCHA_UNSOLVABLE (2captcha fluke, not our fault)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await scrapePalmBeachClerkOnce(apiKey)
    } catch (err) {
      if (attempt < 2 && String(err).includes('ERROR_CAPTCHA_UNSOLVABLE')) {
        console.log(`[palm-beach] CAPTCHA unsolvable — retrying (attempt ${attempt + 1}/2)…`)
        continue
      }
      throw err
    }
  }
  return []
}

async function scrapePalmBeachClerkOnce(apiKey: string): Promise<ClerkRecord[]> {
  const fromDate = toFormDate(getWeekAgo())  // MM/DD/YYYY
  const toDate   = toFormDate(today())

  // ── Step 1: Accept disclaimer ─────────────────────────────────────────────
  console.log('[palm-beach] Accepting disclaimer…')
  const disclaimerRes = await fetch(`${BASE}/Search/SetDisclaimer`, {
    method:  'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ isAccepted: true }),
    signal:  AbortSignal.timeout(15_000),
  })
  console.log(`[palm-beach] SetDisclaimer → ${disclaimerRes.status}`)

  let cookies = extractCookies(disclaimerRes)

  // ── Step 2: Load search page → find dynamic sitekey ──────────────────────
  console.log('[palm-beach] Loading search page for sitekey…')
  const searchPageRes = await fetch(`${BASE}/Search`, {
    headers: { ...HEADERS, Cookie: cookies },
    signal:  AbortSignal.timeout(15_000),
  })
  cookies = mergeCookies(cookies, extractCookies(searchPageRes))
  const searchHtml = await searchPageRes.text()

  const $page    = cheerio.load(searchHtml)
  let   siteKey  = $page('[data-sitekey]').first().attr('data-sitekey') || ''

  // Also check script tags / inline config for the sitekey
  if (!siteKey) {
    const scriptText = $page('script').text()
    const match = scriptText.match(/['"](6L[A-Za-z0-9_-]{38})['"]/)?.[1]
    if (match) siteKey = match
  }

  // Hard-code a fallback if page scraping fails (update if it changes)
  if (!siteKey) {
    console.log('[palm-beach] WARNING: sitekey not found in page HTML — using known fallback')
    siteKey = '6LdpHyQTAAAAABDGh09RRhOI3T6f0JoVJFR_IIMM'
  }

  console.log(`[palm-beach] siteKey=${siteKey.slice(0, 20)}…`)

  // ── Step 3: Solve reCAPTCHA v2 ────────────────────────────────────────────
  console.log('[palm-beach] Solving reCAPTCHA v2…')
  const captchaToken = await solveCaptcha({
    apiKey,
    siteKey,
    pageUrl: PAGE_URL,
    type:    'v2',
  })

  // ── Step 4: Search for document type 20 (Lis Pendens) ────────────────────
  // Try JSON body first (modern Tyler eRecords API)
  console.log(`[palm-beach] Searching doc type 20 (LP) from ${fromDate} to ${toDate}…`)

  const jsonBody = {
    doctype:              '20',
    beginDate:            fromDate,
    endDate:              toDate,
    recordCount:          300,
    'g-recaptcha-response': captchaToken,
  }

  const searchRes = await fetch(`${BASE}/Search/DocumentTypeSearch`, {
    method:  'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json',
      'Cookie':       cookies,
    },
    body:   JSON.stringify(jsonBody),
    signal: AbortSignal.timeout(30_000),
  })

  let responseText = await searchRes.text()
  console.log(`[palm-beach] DocumentTypeSearch → ${searchRes.status}, body=${responseText.slice(0, 300)}`)

  // ── Step 4b: Retry as form-encoded (some Tyler builds use form-post) ──────
  if (!searchRes.ok || responseText.toLowerCase().includes('invalid captcha')) {
    console.log('[palm-beach] JSON body failed, retrying as form-encoded…')

    // Re-solve CAPTCHA since token was likely consumed
    const captchaToken2 = await solveCaptcha({ apiKey, siteKey, pageUrl: PAGE_URL, type: 'v2' })

    const formBody = new URLSearchParams({
      doctype:                '20',
      beginDate:              fromDate,
      endDate:                toDate,
      recordCount:            '300',
      'g-recaptcha-response': captchaToken2,
    })

    const formRes = await fetch(`${BASE}/Search/DocumentTypeSearch`, {
      method:  'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie':       cookies,
      },
      body:   formBody.toString(),
      signal: AbortSignal.timeout(30_000),
    })

    responseText = await formRes.text()
    console.log(`[palm-beach] Form retry → ${formRes.status}, body=${responseText.slice(0, 300)}`)
  }

  // ── Step 5: Parse results ─────────────────────────────────────────────────
  // Response is usually JSON array or { results: [...] }
  try {
    const data = JSON.parse(responseText)
    const items: Record<string, unknown>[] = Array.isArray(data)
      ? data
      : (data.results || data.records || data.data || data.items || [])

    const records: ClerkRecord[] = items.map((item, idx) => {
      const instrNum  = String(item.instrumentNumber || item.InstrumentNumber || item.caseNumber || `PB-${idx}`)
      const recDate   = parseDate(String(item.recordedDate || item.RecordedDate || item.fileDate || '')) || today()
      const grantor   = String(item.grantor || item.Grantor || item.grantorName || item.mortgagor || '')
      const grantee   = String(item.grantee || item.Grantee || item.granteeName || item.lender || '')
      const amount    = parseFloat(String(item.consideration || item.amount || '0')) || 0

      return {
        case_number:        instrNum,
        file_date:          recDate,
        plaintiff:          grantee,
        mortgagor:          grantor,
        foreclosure_amount: amount,
        lender_name:        grantee,
        foreclosure_type:   'P' as const,
        multiple_liens:     false,
        county:             'palm-beach' as const,
      }
    })

    console.log(`[palm-beach] Parsed ${records.length} lis pendens from JSON`)
    return records
  } catch {
    // Fallback: try HTML table parsing
    console.log('[palm-beach] Response not JSON, trying HTML parse…')
    return parsePalmBeachHtml(responseText)
  }
}

function parsePalmBeachHtml(html: string): ClerkRecord[] {
  const $ = cheerio.load(html)
  const records: ClerkRecord[] = []

  $('table tr, #resultsGrid tr').not(':first').each((_, row) => {
    const cells = $(row).find('td')
    if (cells.length < 3) return

    const instrNum  = $(cells[0]).text().trim()
    const recDate   = $(cells.length > 2 ? cells[2] : cells[1]).text().trim()
    const grantor   = $(cells.length > 3 ? cells[3] : cells[0]).text().trim()
    const grantee   = $(cells.length > 4 ? cells[4] : cells[0]).text().trim()

    if (!instrNum) return

    records.push({
      case_number:        instrNum,
      file_date:          parseDate(recDate) || today(),
      plaintiff:          grantee,
      mortgagor:          grantor,
      foreclosure_amount: 0,
      lender_name:        grantee,
      foreclosure_type:   'P' as const,
      multiple_liens:     false,
      county:             'palm-beach' as const,
    })
  })

  console.log(`[palm-beach] HTML parse: ${records.length} rows`)
  return records
}
