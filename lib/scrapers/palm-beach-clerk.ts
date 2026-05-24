/**
 * Palm Beach County Clerk — Official Records / eCaseView
 * Pre-foreclosure / Lis Pendens scraper
 *
 * Search URL: https://appsgp.mypalmbeachclerk.com/eCaseView/InitialSearch.aspx
 * OR: https://www.mypalmbeachclerk.com/official-records
 */

import * as cheerio from 'cheerio'
import type { ClerkRecord } from './types'
import { parseDate, parseMoney, getWeekAgo, today, toFormDate } from './utils'

const BASE_URL = 'https://appsgp.mypalmbeachclerk.com/eCaseView'
const OR_URL   = 'https://or.pbcgov.com/or'
const HEADERS  = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
}

export async function scrapePalmBeachClerk(): Promise<ClerkRecord[]> {
  const records: ClerkRecord[] = []

  try {
    // Try the Official Records search for Lis Pendens instrument type
    const fromDate = toFormDate(getWeekAgo())
    const toDate   = toFormDate(today())

    // Palm Beach OR search endpoint
    const res = await fetch(
      `${OR_URL}/Search.aspx?SearchType=OR&InstrType=LIS+PENDENS&FromDate=${fromDate}&ToDate=${toDate}`,
      { headers: HEADERS, signal: AbortSignal.timeout(30000) }
    )

    if (!res.ok) throw new Error(`Palm Beach OR search failed: ${res.status}`)
    const html = await res.text()
    const $ = cheerio.load(html)

    // Parse OR results table
    $('table tr').not(':first').each((_, row) => {
      const cells = $(row).find('td')
      if (cells.length < 4) return

      // Palm Beach OR column order:
      // [0] Instrument# / Book-Page, [1] Instrument Type, [2] Date Recorded,
      // [3] Grantor (Mortgagor), [4] Grantee (Plaintiff)
      const instrumentNum = $(cells[0]).text().trim()
      const instrumentType = $(cells[1]).text().trim().toLowerCase()
      const recordDate = $(cells[2]).text().trim()
      const mortgagor = $(cells[3]).text().trim()
      const plaintiff  = $(cells[4]).text().trim()

      if (!instrumentType.includes('lis') && !instrumentType.includes('pendens')) return
      if (!mortgagor) return

      records.push({
        case_number: instrumentNum || `PB-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        file_date: parseDate(recordDate) || today(),
        plaintiff,
        mortgagor,
        foreclosure_amount: 0,
        lender_name: plaintiff,
        foreclosure_type: 'P',
        multiple_liens: false,
        county: 'palm-beach',
      })
    })

    // Fallback: Try eCaseView for civil foreclosure cases
    if (records.length === 0) {
      await scrapePalmBeachCivilCases(records)
    }

    console.log(`Palm Beach clerk: found ${records.length} lis pendens`)
    return records
  } catch (err) {
    console.error('Palm Beach clerk scrape error:', err)
    throw err
  }
}

async function scrapePalmBeachCivilCases(records: ClerkRecord[]): Promise<void> {
  try {
    // Try eCaseView civil case search
    const initRes = await fetch(`${BASE_URL}/InitialSearch.aspx`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    })
    if (!initRes.ok) return

    const initHtml = await initRes.text()
    const $init = cheerio.load(initHtml)

    const viewstate = $init('#__VIEWSTATE').val() as string || ''
    const eventval  = $init('#__EVENTVALIDATION').val() as string || ''

    const fromDate = getWeekAgo()
    const formData = new URLSearchParams({
      '__VIEWSTATE': viewstate,
      '__EVENTVALIDATION': eventval,
      'ctl00$MainContent$txtCaseType': 'CA',  // Civil Action
      'ctl00$MainContent$txtFromDate': fromDate,
      'ctl00$MainContent$txtToDate': today(),
      'ctl00$MainContent$btnSearch': 'Search',
    })

    const searchRes = await fetch(`${BASE_URL}/InitialSearch.aspx`, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${BASE_URL}/InitialSearch.aspx`,
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(30000),
    })

    if (!searchRes.ok) return
    const html = await searchRes.text()
    const $ = cheerio.load(html)

    $('table.results tr, #gvResults tr').not(':first').each((_, row) => {
      const cells = $(row).find('td')
      if (cells.length < 4) return

      const caseNum  = $(cells[0]).text().trim()
      const fileDate = $(cells[2]).text().trim()
      const parties  = $(cells[3]).text().trim()

      if (!caseNum) return

      const [plaintiff, mortgagor] = parties.split(/\s+v\.?\s+/i)

      records.push({
        case_number: caseNum,
        file_date: parseDate(fileDate) || today(),
        plaintiff: plaintiff?.trim() || '',
        mortgagor: mortgagor?.trim() || '',
        foreclosure_amount: 0,
        lender_name: plaintiff?.trim() || '',
        foreclosure_type: 'P',
        multiple_liens: false,
        county: 'palm-beach',
      })
    })
  } catch (err) {
    console.error('Palm Beach eCaseView fallback error:', err)
  }
}
