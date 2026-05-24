/**
 * Broward County Clerk — Civil / Foreclosure Case Search
 *
 * System: ASP.NET MVC with reCAPTCHA v2
 * Base:   https://www.browardclerk.org/Web2/CaseSearchECA
 *
 * Flow (confirmed via live form inspection):
 *   1. GET /Index/?AccessLevel=ANONYMOUS — capture __RequestVerificationToken + cookies
 *   2. Solve reCAPTCHA v2 (sitekey = SITE_KEY below, confirmed from page source)
 *   3. POST /BusinessSearchResultsCAPTCHA with:
 *        BusiName, filingDateOnOrAfterB, filingDateOnOrBeforeB,
 *        __RequestVerificationToken, g-recaptcha-response
 *   4. Parse HTML table of case results, filter for foreclosure case types
 *
 * Strategy: Try a single empty-name date-range search first (1 CAPTCHA solve).
 * Fall back to per-lender searches only if needed.
 */

import * as cheerio from 'cheerio'
import type { ClerkRecord } from './types'
import { parseDate, today, getWeekAgo } from './utils'
import { solveCaptcha } from './captcha'

const BASE       = 'https://www.browardclerk.org/Web2/CaseSearchECA'
const SEARCH_URL = `${BASE}/Index/?AccessLevel=ANONYMOUS`
const POST_URL   = `${BASE}/BusinessSearchResultsCAPTCHA`
const SITE_KEY   = '6LeomjoqAAAAANqUs56ZxerFIcoUS1qL14rTH4aF'  // v2, confirmed
const PAGE_URL   = SEARCH_URL

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://www.browardclerk.org/',
}

// Foreclosure case types on Broward civil docket
const FORECLOSURE_TYPES = ['fore', 'mortgage', 'cace']

// Top FL foreclosure servicers — fallback if broad search returns nothing.
// Capped at 5 to stay within the 5-min Lambda budget (each needs a CAPTCHA solve).
const LENDERS = [
  'NATIONSTAR', 'FREEDOM MORTGAGE', 'NEWREZ', 'PENNYMAC', 'LAKEVIEW LOAN',
]

// Extract all Set-Cookie values from a Response into a single Cookie string
function extractCookies(res: Response): string {
  // Node.js 18+ Headers may expose getSetCookie()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setCookieFn = (res.headers as any).getSetCookie
  const raw: string[] = typeof setCookieFn === 'function'
    ? setCookieFn.call(res.headers)
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])

  return raw.map(c => c.split(';')[0]).join('; ')
}

export async function scrapeBrowardClerk(): Promise<ClerkRecord[]> {
  const apiKey = process.env.TWOCAPTCHA_API_KEY
  if (!apiKey) throw new Error('TWOCAPTCHA_API_KEY not set')

  const fromDate = getWeekAgo()  // YYYY-MM-DD
  const toDate   = today()

  // Broward date inputs are type="date" → expect YYYY-MM-DD
  const fromForm = fromDate  // already YYYY-MM-DD from getWeekAgo()
  const toForm   = toDate    // already YYYY-MM-DD from today()

  // ── Step 1: load search page → get CSRF token + cookies ──────────────────
  console.log(`[broward] Loading search page…`)
  const initRes = await fetch(SEARCH_URL, {
    headers: HEADERS,
    signal:  AbortSignal.timeout(20_000),
  })
  if (!initRes.ok) throw new Error(`Broward init page: ${initRes.status}`)

  const cookieJar = extractCookies(initRes)
  const initHtml  = await initRes.text()
  const $init     = cheerio.load(initHtml)
  const csrf      = ($init('input[name="__RequestVerificationToken"]').val() as string) || ''

  console.log(`[broward] CSRF token found: ${csrf ? 'yes' : 'NO'} (${csrf.slice(0, 12)}…)`)

  // Try broad date-range search first (empty BusiName = all filings)
  const records = await searchBroward(apiKey, '', fromForm, toForm, csrf, cookieJar)

  if (records.length > 0) {
    console.log(`[broward] Broad search: ${records.length} foreclosure cases`)
    return records
  }

  // Fallback: search by each major lender name
  console.log('[broward] Broad search returned 0 — falling back to per-lender searches')
  const allRecords: ClerkRecord[] = []
  const seen = new Set<string>()

  for (const lender of LENDERS) {
    try {
      // Re-load page for fresh CSRF / cookies each time
      const pageRes = await fetch(SEARCH_URL, {
        headers: HEADERS,
        signal: AbortSignal.timeout(20_000),
      })
      if (!pageRes.ok) continue
      const pageCookies = extractCookies(pageRes)
      const pageHtml    = await pageRes.text()
      const $page       = cheerio.load(pageHtml)
      const pageCsrf    = ($page('input[name="__RequestVerificationToken"]').val() as string) || ''

      const lenderRecords = await searchBroward(apiKey, lender, fromForm, toForm, pageCsrf, pageCookies)
      for (const r of lenderRecords) {
        if (!seen.has(r.case_number)) {
          seen.add(r.case_number)
          allRecords.push(r)
        }
      }
    } catch (e) {
      console.log(`[broward] Lender "${lender}" search error: ${e}`)
    }
  }

  console.log(`[broward] Per-lender fallback: ${allRecords.length} foreclosure cases`)
  return allRecords
}

async function searchBroward(
  apiKey:    string,
  busiName:  string,
  fromDate:  string, // MM/DD/YYYY
  toDate:    string,
  csrf:      string,
  cookies:   string,
): Promise<ClerkRecord[]> {
  // ── Solve v2 CAPTCHA ─────────────────────────────────────────────────────
  console.log(`[broward] Solving reCAPTCHA v2 for "${busiName || '<all>'}"…`)
  const captchaToken = await solveCaptcha({
    apiKey,
    siteKey:  SITE_KEY,
    pageUrl:  PAGE_URL,
    type:     'v2',
  })

  // ── POST search form ──────────────────────────────────────────────────────
  const formData = new URLSearchParams({
    '__RequestVerificationToken': csrf,
    'CaseCategoryKeys2':          'CV',         // Civil only (foreclosures are civil cases)
    'BusiName':                   busiName,
    'filingDateOnOrAfterB':       fromDate,      // YYYY-MM-DD (type="date" field)
    'filingDateOnOrBeforeB':      toDate,
    'AccessLevel':                'ANONYMOUS',
    'g-recaptcha-response':       captchaToken,
  })

  const res = await fetch(POST_URL, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer':      SEARCH_URL,
      'Cookie':       cookies,
    },
    body:   formData.toString(),
    signal: AbortSignal.timeout(30_000),
  })

  const html = await res.text()
  // Log enough of the response to diagnose table structure
  console.log(`[broward] POST status=${res.status} len=${html.length}`)
  console.log(`[broward] HTML preview: ${html.replace(/\s+/g, ' ').slice(0, 600)}`)

  if (!res.ok) {
    console.log(`[broward] POST failed: ${res.status}`)
    return []
  }

  return parseBrowardResults(html, busiName)
}

function parseBrowardResults(html: string, lenderHint: string): ClerkRecord[] {
  const $ = cheerio.load(html)
  const records: ClerkRecord[] = []

  // Try multiple table selectors — Broward result table varies
  const rows = $(
    '#ctl00_cphPage_gvCases tr, table.case-list tr, .searchResults tr, ' +
    '#searchResults tr, table.table tr, table tr'
  ).not(':first').toArray()

  console.log(`[broward] Parsing ${rows.length} result rows`)

  for (const row of rows) {
    const cells = $(row).find('td')
    if (cells.length < 3) continue

    const caseNum  = $(cells[0]).text().trim()
    const caseType = $(cells[1]).text().trim()
    const fileDate = $(cells[2]).text().trim()
    const parties  = cells.length > 3 ? $(cells[3]).text().trim() : ''

    if (!caseNum || !/^\d{4}-CA-\d+|^\d{2}-\d{4,}/i.test(caseNum)) continue

    // Only keep foreclosure case types
    const typeLower = caseType.toLowerCase()
    const isFore    = FORECLOSURE_TYPES.some(t => typeLower.includes(t))
    if (!isFore) continue

    // Try to split "Plaintiff v. Defendant" from parties column
    const vsSplit = parties.split(/\s+vs?\.?\s+/i)
    const plaintiff = vsSplit[0]?.trim() || lenderHint
    const mortgagor = vsSplit[1]?.trim() || ''

    records.push({
      case_number:        caseNum,
      file_date:          parseDate(fileDate) || today(),
      plaintiff,
      mortgagor,
      foreclosure_amount: 0,
      lender_name:        plaintiff || lenderHint,
      foreclosure_type:   'P' as const,
      multiple_liens:     false,
      county:             'broward' as const,
    })
  }

  return records
}
