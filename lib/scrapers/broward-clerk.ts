/**
 * Broward County Clerk — Civil Case Search
 * URL: https://www.browardclerk.org/Web2/CaseSearchECA/Index/?AccessLevel=ANONYMOUS
 *
 * Strategy: Search by major foreclosure lender names + date range
 * The Broward search requires a party name — we search the top FL foreclosure servicers
 * to capture the majority of new filings each week.
 */

import * as cheerio from 'cheerio'
import type { ClerkRecord } from './types'
import { parseDate, today, getWeekAgo } from './utils'

const BASE_URL = 'https://www.browardclerk.org/Web2/CaseSearchECA'
const SEARCH_URL = `${BASE_URL}/Index/?AccessLevel=ANONYMOUS`

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.browardclerk.org/',
}

// Top foreclosure servicers in South Florida — covers ~80% of filings
// We search each by business name + date range + foreclosure case type
const LENDERS = [
  'BANK OF AMERICA',
  'WELLS FARGO',
  'NATIONSTAR',
  'FREEDOM MORTGAGE',
  'LAKEVIEW LOAN',
  'PLANET HOME',
  'PENNYMAC',
  'NEWREZ',
  'CARRINGTON',
  'SELENE FINANCE',
  'BSI FINANCIAL',
  'RUSHMORE LOAN',
  'US BANK',
  'DEUTSCHE BANK',
]

// Broward foreclosure case types
const FORECLOSURE_CASE_TYPES = [
  'Real Prop Homestead Res Fore',
  'Real Prop Non-Homestead Res Fore',
  'Real Prop Commercial Foreclosure',
]

export async function scrapeBrowardClerk(): Promise<ClerkRecord[]> {
  const allRecords: ClerkRecord[] = []
  const seen = new Set<string>()
  const fromDate = getWeekAgo()
  const toDate   = today()

  // First try: search by each lender business name
  for (const lender of LENDERS) {
    try {
      const records = await searchBrowardByBusiness(lender, fromDate, toDate)
      for (const r of records) {
        if (!seen.has(r.case_number)) {
          seen.add(r.case_number)
          allRecords.push(r)
        }
      }
    } catch (e) {
      console.log(`Broward lender search "${lender}" failed: ${e}`)
    }
  }

  // If lender search yielded results, we're done
  if (allRecords.length > 0) {
    console.log(`Broward clerk: found ${allRecords.length} cases via lender search`)
    return allRecords
  }

  // Fallback: try the JSON API endpoint some courts expose
  try {
    const jsonRecords = await searchBrowardViaAPI(fromDate, toDate)
    return jsonRecords
  } catch (e) {
    console.log(`Broward JSON API fallback failed: ${e}`)
  }

  console.log('Broward clerk: 0 records found')
  return allRecords
}

async function searchBrowardByBusiness(
  businessName: string,
  fromDate: string,
  toDate: string
): Promise<ClerkRecord[]> {
  const records: ClerkRecord[] = []

  // Get initial page for form tokens
  const initRes = await fetch(SEARCH_URL, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  })
  if (!initRes.ok) return []

  const initHtml = await initRes.text()
  const $init = cheerio.load(initHtml)
  const viewstate    = ($init('#__VIEWSTATE').val() as string) || ''
  const eventval     = ($init('#__EVENTVALIDATION').val() as string) || ''

  // Submit business name search with date range
  const formData = new URLSearchParams({
    '__VIEWSTATE': viewstate,
    '__EVENTVALIDATION': eventval,
    '__EVENTTARGET': 'ctl00$cphPage$btnBusinessSearch',
    'ctl00$cphPage$txtBusinessName': businessName,
    'ctl00$cphPage$txtBusinessDateFrom': fromDate,
    'ctl00$cphPage$txtBusinessDateTo': toDate,
    'ctl00$cphPage$ddlBusinessCourtType': 'Civil',
  })

  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return []

  const html = await res.text()
  const $ = cheerio.load(html)

  // Parse results — try multiple selectors
  const rows = $(
    '#ctl00_cphPage_gvCases tr, table.case-list tr, .searchResults tr, table tr'
  ).not(':first').toArray()

  for (const row of rows) {
    const cells = $(row).find('td')
    if (cells.length < 4) continue

    const caseNum  = $(cells[0]).text().trim()
    const caseType = $(cells[1]).text().trim()
    const fileDate = $(cells[2]).text().trim()
    const status   = $(cells[3]).text().trim()

    // Only keep foreclosure case types
    const isForeclosure = FORECLOSURE_CASE_TYPES.some(t =>
      caseType.toLowerCase().includes('fore') ||
      caseType.toLowerCase().includes('mortgage')
    )
    if (!isForeclosure || !caseNum) continue

    records.push({
      case_number:       caseNum,
      file_date:         parseDate(fileDate) || today(),
      plaintiff:         businessName,
      mortgagor:         '',   // Not available from this search view — need detail page
      foreclosure_amount: 0,
      lender_name:       businessName,
      foreclosure_type:  'P',
      multiple_liens:    false,
      county:            'broward',
    })
  }

  return records
}

async function searchBrowardViaAPI(fromDate: string, toDate: string): Promise<ClerkRecord[]> {
  // Try Broward's internal API endpoints (some clerk systems expose these)
  const apiUrls = [
    `${BASE_URL}/api/cases?filedFrom=${fromDate}&filedTo=${toDate}&caseType=CACE`,
    `${BASE_URL}/Search?searchType=FiledDate&from=${fromDate}&to=${toDate}&type=CACE&format=json`,
  ]

  for (const url of apiUrls) {
    try {
      const res = await fetch(url, {
        headers: { ...HEADERS, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue
      const data = await res.json()
      const cases = Array.isArray(data) ? data : (data.cases || data.results || [])

      return cases
        .filter((c: Record<string, unknown>) => {
          const type = String(c.caseType || c.CaseType || '').toLowerCase()
          return type.includes('fore') || type.includes('cace')
        })
        .map((c: Record<string, unknown>) => ({
          case_number: String(c.caseNumber || c.CaseNumber || ''),
          file_date:   parseDate(String(c.filedDate || c.FiledDate || '')) || today(),
          plaintiff:   String(c.plaintiff || c.Plaintiff || ''),
          mortgagor:   String(c.defendant || c.Defendant || ''),
          foreclosure_amount: 0,
          lender_name: String(c.plaintiff || c.Plaintiff || ''),
          foreclosure_type: 'P' as const,
          multiple_liens: false,
          county:      'broward' as const,
        }))
    } catch { continue }
  }
  return []
}
