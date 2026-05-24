/**
 * Miami-Dade County Clerk — Official Records Search
 * Lis Pendens (pre-foreclosure) scraper
 *
 * OCS URL: https://www2.miami-dadeclerk.com/ocs/Search.aspx
 * Instrument Type: LIS PENDENS
 */

import * as cheerio from 'cheerio'
import type { ClerkRecord } from './types'
import { parseDate, parseMoney, getWeekAgo, today, toFormDate } from './utils'

const BASE_URL = 'https://www2.miami-dadeclerk.com/ocs'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
}

export async function scrapeMiamiDadeClerk(): Promise<ClerkRecord[]> {
  const records: ClerkRecord[] = []
  const fromDate = toFormDate(getWeekAgo())
  const toDate   = toFormDate(today())

  try {
    // Step 1: Get the search form to extract ASP.NET viewstate tokens
    const initRes = await fetch(`${BASE_URL}/Search.aspx`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(30000),
    })
    if (!initRes.ok) throw new Error(`Init request failed: ${initRes.status}`)

    const initHtml = await initRes.text()
    const $init = cheerio.load(initHtml)

    const viewstate          = $init('#__VIEWSTATE').val() as string || ''
    const viewstategen       = $init('#__VIEWSTATEGENERATOR').val() as string || ''
    const eventvalidation    = $init('#__EVENTVALIDATION').val() as string || ''

    // Step 2: Submit search for Lis Pendens in date range
    const formData = new URLSearchParams({
      '__VIEWSTATE': viewstate,
      '__VIEWSTATEGENERATOR': viewstategen,
      '__EVENTVALIDATION': eventvalidation,
      '__EVENTTARGET': '',
      '__EVENTARGUMENT': '',
      'ctl00$cphPage$txtFromDate': fromDate,
      'ctl00$cphPage$txtToDate': toDate,
      'ctl00$cphPage$ddlInstrumentType': 'LIS PENDENS',
      'ctl00$cphPage$btnNameSearch': 'Search',
      'ctl00$cphPage$txtLastName': '',
      'ctl00$cphPage$txtFirstName': '',
    })

    const searchRes = await fetch(`${BASE_URL}/Search.aspx`, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${BASE_URL}/Search.aspx`,
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(30000),
    })

    if (!searchRes.ok) throw new Error(`Search request failed: ${searchRes.status}`)
    const searchHtml = await searchRes.text()
    const $ = cheerio.load(searchHtml)

    // Step 3: Parse results table
    // The OCS results are in a table with class 'detailsTable' or similar
    const rows = $('table.searchResults tr, table#resultsTable tr, .gvResults tr').not(':first').toArray()

    for (const row of rows) {
      const cells = $(row).find('td')
      if (cells.length < 4) continue

      // OCS column order (may vary — adjust after live test):
      // [0] Book/Page, [1] Instrument Type, [2] Recording Date, [3] Grantor (Mortgagor),
      // [4] Grantee (Plaintiff/Lender), [5] Legal Description, [6] Folio
      const recordingDate  = $(cells[2]).text().trim()
      const mortgagor      = $(cells[3]).text().trim()
      const plaintiff      = $(cells[4]).text().trim()
      const legal          = $(cells[5]).text().trim()
      const folio          = $(cells[6]).text().trim().replace(/[-\s]/g, '')

      // Try to extract case number from a link or hidden field
      const caseNum = $(row).find('a').first().attr('href')?.match(/DocNum=([^&]+)/)?.[1]
        || $(cells[0]).text().trim()

      if (!mortgagor && !plaintiff) continue

      records.push({
        case_number: caseNum || `MD-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        file_date: parseDate(recordingDate) || today(),
        plaintiff: plaintiff,
        mortgagor: mortgagor,
        foreclosure_amount: 0,  // Will be filled from detail page if needed
        lender_name: plaintiff,
        foreclosure_type: 'P',
        multiple_liens: false,
        folio_number: folio || undefined,
        legal_description: legal,
        county: 'miami-dade',
      })
    }

    // Pagination — handle multiple pages if needed
    const nextBtn = $('a:contains("Next"), input[value="Next"]').first()
    if (nextBtn.length && records.length >= 20) {
      // For now, process first page. Add pagination in v2 if needed.
      console.log(`Miami-Dade: ${records.length} records on page 1, more available`)
    }

    console.log(`Miami-Dade clerk: found ${records.length} lis pendens`)
    return records
  } catch (err) {
    console.error('Miami-Dade clerk scrape error:', err)
    throw err
  }
}

/**
 * Fetch individual document detail to get foreclosure amount
 * Called selectively when foreclosure_amount is missing
 */
export async function fetchMDDocDetail(docUrl: string): Promise<{ amount?: number; caseNumber?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/${docUrl}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return {}
    const html = await res.text()
    const $ = cheerio.load(html)

    // Look for dollar amount in the document text
    const text = $('body').text()
    const amtMatch = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/g)
    const amounts = (amtMatch || [])
      .map(s => parseMoney(s))
      .filter((n): n is number => n !== undefined && n > 10000)
      .sort((a, b) => b - a)

    return { amount: amounts[0] }
  } catch {
    return {}
  }
}
