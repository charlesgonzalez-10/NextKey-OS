/**
 * Palm Beach County Clerk — Official Records & eCaseView
 * Searches for lis pendens / foreclosure filings
 *
 * Correct URLs (verified):
 * - eCaseView: https://appsgp.mypalmbeachclerk.com/eCaseView/
 * - OR Search: https://www.mypalmbeachclerk.com/official-records
 */

import * as cheerio from 'cheerio'
import type { ClerkRecord } from './types'
import { parseDate, today, getWeekAgo, toFormDate } from './utils'

const ECASEVIEW_URL = 'https://appsgp.mypalmbeachclerk.com/eCaseView'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

// Same lender strategy as Broward for Palm Beach eCaseView
const LENDERS = [
  'BANK OF AMERICA',
  'WELLS FARGO',
  'NATIONSTAR',
  'FREEDOM MORTGAGE',
  'PENNYMAC',
  'NEWREZ',
  'US BANK',
  'DEUTSCHE BANK',
  'LAKEVIEW LOAN',
  'CARRINGTON',
]

export async function scrapePalmBeachClerk(): Promise<ClerkRecord[]> {
  const allRecords: ClerkRecord[] = []
  const seen = new Set<string>()
  const fromDate = getWeekAgo()
  const toDate   = today()

  // Strategy 1: eCaseView search by lender names
  for (const lender of LENDERS) {
    try {
      const records = await searchPalmBeacheCaseView(lender, fromDate, toDate)
      for (const r of records) {
        if (!seen.has(r.case_number)) {
          seen.add(r.case_number)
          allRecords.push(r)
        }
      }
    } catch (e) {
      console.log(`Palm Beach lender "${lender}" search error: ${e}`)
    }
  }

  if (allRecords.length > 0) {
    console.log(`Palm Beach clerk: found ${allRecords.length} cases via lender search`)
    return allRecords
  }

  // Strategy 2: Try OR system search for lis pendens instrument type
  try {
    const orRecords = await searchPalmBeachOR(fromDate, toDate)
    if (orRecords.length > 0) {
      console.log(`Palm Beach OR: found ${orRecords.length} lis pendens`)
      return orRecords
    }
  } catch (e) {
    console.log(`Palm Beach OR search error: ${e}`)
  }

  console.log('Palm Beach clerk: 0 records found')
  return allRecords
}

async function searchPalmBeacheCaseView(
  partyName: string,
  fromDate: string,
  toDate: string
): Promise<ClerkRecord[]> {
  const records: ClerkRecord[] = []

  // Try to get the eCaseView search page
  const initPaths = ['/InitialSearch.aspx', '/Search.aspx', '/CaseSearch.aspx', '/']
  let workingUrl: string | null = null
  let initHtml = ''

  for (const path of initPaths) {
    try {
      const res = await fetch(`${ECASEVIEW_URL}${path}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        workingUrl = `${ECASEVIEW_URL}${path}`
        initHtml = await res.text()
        console.log(`Palm Beach eCaseView: found path ${path}`)
        break
      }
    } catch { continue }
  }

  if (!workingUrl || !initHtml) {
    throw new Error('Palm Beach eCaseView: no working search path found')
  }

  const $init = cheerio.load(initHtml)
  const viewstate = ($init('#__VIEWSTATE').val() as string) || ''
  const eventval  = ($init('#__EVENTVALIDATION').val() as string) || ''

  const formData = new URLSearchParams({
    '__VIEWSTATE': viewstate,
    '__EVENTVALIDATION': eventval,
    'ctl00$MainContent$txtLastName': partyName,
    'ctl00$MainContent$txtFirstName': '',
    'ctl00$MainContent$txtFromDate': fromDate,
    'ctl00$MainContent$txtToDate': toDate,
    'ctl00$MainContent$ddlCaseType': 'CA',  // Civil Action
    'ctl00$MainContent$btnSearch': 'Search',
  })

  const res = await fetch(workingUrl, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': workingUrl,
    },
    body: formData.toString(),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return []

  const html = await res.text()
  const $ = cheerio.load(html)

  $('table tr, #gvResults tr').not(':first').each((_, row) => {
    const cells = $(row).find('td')
    if (cells.length < 4) return

    const caseNum  = $(cells[0]).text().trim()
    const caseType = $(cells[1]).text().trim().toLowerCase()
    const fileDate = $(cells[2]).text().trim()
    const parties  = $(cells[3]).text().trim()

    if (!caseNum) return
    if (!caseType.includes('fore') && !caseType.includes('mortgage') && !caseType.includes('civil')) return

    const [plaintiff, mortgagor] = parties.split(/\s+vs?\.?\s+/i)

    records.push({
      case_number:       caseNum,
      file_date:         parseDate(fileDate) || today(),
      plaintiff:         plaintiff?.trim() || partyName,
      mortgagor:         mortgagor?.trim() || '',
      foreclosure_amount: 0,
      lender_name:       partyName,
      foreclosure_type:  'P',
      multiple_liens:    false,
      county:            'palm-beach',
    })
  })

  return records
}

async function searchPalmBeachOR(fromDate: string, toDate: string): Promise<ClerkRecord[]> {
  // Try Palm Beach Official Records system — multiple possible URLs
  const orUrls = [
    `https://www.mypalmbeachclerk.com/official-records/search?type=LIS+PENDENS&from=${fromDate}&to=${toDate}`,
    `https://appsgp.mypalmbeachclerk.com/OfficialRecords/Search?instrumentType=LIS+PENDENS&fromDate=${toFormDate(fromDate)}&toDate=${toFormDate(toDate)}`,
    `https://efts.mypalmbeachclerk.com/EFTS/public/records?type=lis-pendens&start=${fromDate}&end=${toDate}`,
  ]

  for (const url of orUrls) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue

      const text = await res.text()

      // Try JSON response first
      try {
        const data = JSON.parse(text)
        const items = Array.isArray(data) ? data : (data.results || data.records || [])
        if (items.length > 0) {
          return items.map((item: Record<string, unknown>) => ({
            case_number: String(item.instrumentNumber || item.caseNumber || item.id || `PB-${Date.now()}`),
            file_date:   parseDate(String(item.recordedDate || item.fileDate || '')) || today(),
            plaintiff:   String(item.grantee || item.plaintiff || ''),
            mortgagor:   String(item.grantor || item.mortgagor || ''),
            foreclosure_amount: 0,
            lender_name: String(item.grantee || ''),
            foreclosure_type: 'P' as const,
            multiple_liens: false,
            county: 'palm-beach' as const,
          }))
        }
      } catch { /* not JSON */ }

      // Try HTML parsing
      const $ = cheerio.load(text)
      const records: ClerkRecord[] = []
      $('table tr').not(':first').each((_, row) => {
        const cells = $(row).find('td')
        if (cells.length < 3) return
        const instrumentNum = $(cells[0]).text().trim()
        const recDate       = $(cells[2]).text().trim()
        const grantor       = $(cells[3]).text().trim()
        const grantee       = $(cells[4]).text().trim()
        if (!instrumentNum) return
        records.push({
          case_number: instrumentNum,
          file_date:   parseDate(recDate) || today(),
          plaintiff:   grantee,
          mortgagor:   grantor,
          foreclosure_amount: 0,
          lender_name: grantee,
          foreclosure_type: 'P',
          multiple_liens: false,
          county: 'palm-beach',
        })
      })
      if (records.length > 0) return records
    } catch (e) {
      console.log(`Palm Beach OR URL ${url} failed: ${e}`)
    }
  }

  return []
}
