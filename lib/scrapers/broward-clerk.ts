/**
 * Broward County Clerk — Civil Case Search
 * Pre-foreclosure / Lis Pendens scraper
 *
 * Search URL: https://www.browardclerk.org/Web2/CaseSearchECA/Search
 */

import * as cheerio from 'cheerio'
import type { ClerkRecord } from './types'
import { parseDate, parseMoney, getWeekAgo, today } from './utils'

const BASE_URL = 'https://www.browardclerk.org/Web2/CaseSearchECA'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://www.browardclerk.org/',
}

export async function scrapeBrowardClerk(): Promise<ClerkRecord[]> {
  const records: ClerkRecord[] = []
  const fromDate = getWeekAgo()  // YYYY-MM-DD

  try {
    // Broward Clerk uses a REST-style API for case search
    // Case type for mortgage foreclosure: "CACE" (Civil Actions)
    // Filter by filing date range
    const searchUrl = `${BASE_URL}/Search?ctype=CACE&` +
      `filedFrom=${encodeURIComponent(fromDate)}&` +
      `filedTo=${encodeURIComponent(today())}&` +
      `caseStatus=O&` +  // Open cases
      `searchType=DateFiled`

    const res = await fetch(searchUrl, {
      headers: HEADERS,
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) throw new Error(`Broward search failed: ${res.status}`)
    const html = await res.text()
    const $ = cheerio.load(html)

    // Parse results — Broward uses a data table
    $('table.case-list tr, #tblResults tr, .searchResults tr').not(':first').each((_, row) => {
      const cells = $(row).find('td')
      if (cells.length < 5) return

      // Broward column order (verify after live test):
      // [0] Case Number, [1] Case Type, [2] File Date, [3] Status, [4] Parties
      const caseNum   = $(cells[0]).text().trim()
      const fileDate  = $(cells[2]).text().trim()
      const parties   = $(cells[4]).text().trim()

      if (!caseNum) return

      // Parse parties — format is usually "PLAINTIFF vs DEFENDANT"
      const partyParts = parties.split(/\s+vs\.?\s+/i)
      const plaintiff  = partyParts[0]?.trim() || ''
      const mortgagor  = partyParts[1]?.trim() || ''

      // Filter to foreclosure cases only
      const caseType = $(cells[1]).text().trim().toLowerCase()
      if (!caseType.includes('forecl') && !caseType.includes('mortgage') && !caseType.includes('lis')) return

      records.push({
        case_number: caseNum,
        file_date: parseDate(fileDate) || today(),
        plaintiff,
        mortgagor,
        foreclosure_amount: 0,
        lender_name: plaintiff,
        foreclosure_type: 'P',
        multiple_liens: false,
        county: 'broward',
      })
    })

    // If results were returned as JSON (some county systems do this)
    if (records.length === 0) {
      try {
        const jsonRes = await fetch(
          `${BASE_URL}/api/search?ctype=CACE&filedFrom=${fromDate}&filedTo=${today()}`,
          { headers: { ...HEADERS, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }
        )
        if (jsonRes.ok) {
          const data = await jsonRes.json()
          const cases = data?.cases || data?.results || data || []
          for (const c of cases) {
            if (!c.caseNumber) continue
            records.push({
              case_number: c.caseNumber || c.CaseNumber,
              file_date: parseDate(c.fileDate || c.FiledDate) || today(),
              plaintiff: c.plaintiff || c.Plaintiff || '',
              mortgagor: c.defendant || c.Defendant || '',
              foreclosure_amount: parseMoney(c.amount || c.Amount) || 0,
              lender_name: c.plaintiff || c.Plaintiff || '',
              foreclosure_type: 'P',
              multiple_liens: false,
              county: 'broward',
            })
          }
        }
      } catch { /* JSON endpoint not available */ }
    }

    console.log(`Broward clerk: found ${records.length} foreclosure cases`)
    return records
  } catch (err) {
    console.error('Broward clerk scrape error:', err)
    throw err
  }
}
