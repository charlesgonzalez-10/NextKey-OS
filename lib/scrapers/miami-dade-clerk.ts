/**
 * Miami-Dade County Clerk — Official Records Search
 * Domain updated: miami-dadeclerk.com → miamidadeclerk.gov
 * Searches for Lis Pendens instrument type by date range
 */

import * as cheerio from 'cheerio'
import type { ClerkRecord } from './types'
import { parseDate, today, getWeekAgo, toFormDate } from './utils'

// Updated domain — confirmed via 301 redirect from old domain
const BASE_URL = 'https://www2.miamidadeclerk.gov/ocs'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
}

// Known search paths to try (in order)
const SEARCH_PATHS = [
  '/Search.aspx',
  '/RecordSearch.aspx',
  '/InstrumentSearch.aspx',
  '/OfficialRecords/Search.aspx',
]

export async function scrapeMiamiDadeClerk(): Promise<ClerkRecord[]> {
  const records: ClerkRecord[] = []
  const fromDate = toFormDate(getWeekAgo())
  const toDate   = toFormDate(today())

  // Step 1: Find the working search path
  let workingPath: string | null = null
  let initHtml = ''

  for (const path of SEARCH_PATHS) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      })
      if (res.ok) {
        workingPath = path
        initHtml = await res.text()
        console.log(`Miami-Dade OCS: found working path ${path}`)
        break
      }
      console.log(`Miami-Dade OCS path ${path}: ${res.status}`)
    } catch (e) {
      console.log(`Miami-Dade OCS path ${path}: ${e}`)
    }
  }

  if (!workingPath || !initHtml) {
    throw new Error(`Miami-Dade OCS search page not found. Tried: ${SEARCH_PATHS.join(', ')}`)
  }

  const $init = cheerio.load(initHtml)

  // Extract ASP.NET form tokens
  const viewstate       = ($init('#__VIEWSTATE').val() as string) || ''
  const viewstategen    = ($init('#__VIEWSTATEGENERATOR').val() as string) || ''
  const eventvalidation = ($init('#__EVENTVALIDATION').val() as string) || ''

  // Extract cookies from initial response for session continuity
  // (fetch API doesn't expose Set-Cookie in browser but on Node it does via undici)

  // Log available form fields to help debug
  const formFields: string[] = []
  $init('input, select').each((_, el) => {
    const name = $init(el).attr('name')
    if (name) formFields.push(name)
  })
  console.log(`Miami-Dade form fields found: ${formFields.join(', ')}`)

  // Detect the instrument type field name
  const instrField = formFields.find(f =>
    f.toLowerCase().includes('instrument') ||
    f.toLowerCase().includes('instr') ||
    f.toLowerCase().includes('doctype')
  ) || 'ctl00$cphPage$ddlInstrumentType'

  // Detect date fields
  const fromField = formFields.find(f => f.toLowerCase().includes('from') && f.toLowerCase().includes('date'))
    || 'ctl00$cphPage$txtFromDate'
  const toField = formFields.find(f => f.toLowerCase().includes('to') && f.toLowerCase().includes('date'))
    || 'ctl00$cphPage$txtToDate'

  // Detect search button
  const searchBtn = formFields.find(f => f.toLowerCase().includes('search') || f.toLowerCase().includes('btn'))
    || 'ctl00$cphPage$btnNameSearch'

  // Step 2: Submit search
  const formData = new URLSearchParams({
    '__VIEWSTATE': viewstate,
    '__VIEWSTATEGENERATOR': viewstategen,
    '__EVENTVALIDATION': eventvalidation,
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
    [fromField]: fromDate,
    [toField]: toDate,
    [instrField]: 'LIS PENDENS',
    [searchBtn]: 'Search',
  })

  const searchUrl = `${BASE_URL}${workingPath}`
  const searchRes = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': searchUrl,
    },
    body: formData.toString(),
    signal: AbortSignal.timeout(30000),
  })

  if (!searchRes.ok) {
    throw new Error(`Miami-Dade search POST failed: ${searchRes.status}`)
  }

  const html = await searchRes.text()
  const $ = cheerio.load(html)

  // Try multiple table selectors
  const tableSelectors = [
    'table.searchResults tr',
    'table#resultsTable tr',
    '.gvResults tr',
    'table.results tr',
    '#ctl00_cphPage_gvResults tr',
    'table tr',
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = []
  for (const sel of tableSelectors) {
    const found = $(sel).not(':first').toArray()
    if (found.length > 0) {
      rows = found
      console.log(`Miami-Dade: found ${found.length} rows with selector "${sel}"`)
      break
    }
  }

  if (rows.length === 0) {
    // Log page excerpt to help debug HTML structure
    const bodyText = $('body').text().substring(0, 500)
    console.log(`Miami-Dade: no results rows found. Page preview: ${bodyText}`)
  }

  for (const row of rows) {
    const cells = $(row).find('td')
    if (cells.length < 3) continue

    const texts = cells.toArray().map(c => $(c).text().trim())
    console.log(`Miami-Dade row: ${texts.slice(0, 6).join(' | ')}`)

    // Try to extract meaningful fields based on position
    // OCS column order varies — detect by content
    const dateIdx = texts.findIndex(t => /\d{1,2}\/\d{1,2}\/\d{4}/.test(t))
    const amtIdx  = texts.findIndex(t => /\$[\d,]+/.test(t))

    const recordDate = dateIdx >= 0 ? texts[dateIdx] : texts[2] || ''
    const mortgagor  = texts[3] || ''
    const plaintiff  = texts[4] || ''
    const caseNum    = $($(row).find('a').first()).attr('href')?.match(/[Dd]oc(?:Num|Number|ID)=([^&]+)/)?.[1]
      || texts[0] || `MD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    if (!mortgagor && !plaintiff) continue

    records.push({
      case_number:       caseNum,
      file_date:         parseDate(recordDate) || today(),
      plaintiff:         plaintiff,
      mortgagor:         mortgagor,
      foreclosure_amount: 0,
      lender_name:       plaintiff,
      foreclosure_type:  'P',
      multiple_liens:    false,
      county:            'miami-dade',
    })
  }

  console.log(`Miami-Dade clerk: extracted ${records.length} lis pendens`)
  return records
}
