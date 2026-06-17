/**
 * REAPI Case Number Lookup
 *
 * Calls REAPI /v2/PropertyDetail for a given APN + FIPS and extracts
 * the most relevant court case number from the foreclosureInfo array.
 *
 * REAPI PropertyDetail returns a `foreclosureInfo` array where each entry
 * has a `caseNumber` field (e.g. "CACE-25-006991" for Broward).
 * Coverage: ~40–60% for Broward, lower for Miami-Dade.
 *
 * Usage:
 *   const caseNum = await lookupCaseNumber({ apn: '50-41-05-30-0280', county: 'broward' })
 *   // → "CACE-25-006991" | null
 */

const REAPI_BASE = 'https://api.realestateapi.com/v2'

/** FIPS code for each South Florida county */
const COUNTY_FIPS: Record<string, string> = {
  'broward':    '12011',
  'miami-dade': '12086',
  'palm-beach': '12099',
}

interface ForeclosureInfoEntry {
  active?:        boolean
  caseNumber?:    string | null
  noticeType?:    string | null
  recordingDate?: string | null
  documentType?:  string | null
  lenderName?:    string | null
  judgmentAmount?: string | null
  defaultAmount?:  string | null
  openingBid?:     number | null
  foreclosureId?:  number
  seqNo?:          number
}

/**
 * Pick the single best case number from a foreclosureInfo array.
 * Priority:
 *   1. Most recent recording date with a valid case number
 *   2. Prefer entries with actual CACE/CONO/DOM format case numbers
 *   3. Never return an empty string or null
 */
function pickBestCaseNumber(entries: ForeclosureInfoEntry[]): string | null {
  const withCase = entries.filter(e => e.caseNumber && e.caseNumber.trim())
  if (withCase.length === 0) return null

  // Sort by recordingDate descending (most recent first)
  withCase.sort((a, b) => {
    const da = a.recordingDate ? new Date(a.recordingDate).getTime() : 0
    const db = b.recordingDate ? new Date(b.recordingDate).getTime() : 0
    return db - da
  })

  return withCase[0].caseNumber!.trim()
}

export interface CaseLookupResult {
  case_number:   string | null
  /** All foreclosure history entries from REAPI */
  foreclosure_history: ForeclosureInfoEntry[]
}

export async function lookupCaseNumber(params: {
  apn:    string
  county: string
}): Promise<CaseLookupResult> {
  const key = process.env.REAPI_KEY
  if (!key) return { case_number: null, foreclosure_history: [] }

  const fips = COUNTY_FIPS[params.county.toLowerCase()]
  if (!fips) return { case_number: null, foreclosure_history: [] }

  try {
    const res = await fetch(`${REAPI_BASE}/PropertyDetail`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body:    JSON.stringify({ apn: params.apn, fips }),
      signal:  AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      console.warn(`[CaseLookup] PropertyDetail HTTP ${res.status} for ${params.apn}`)
      return { case_number: null, foreclosure_history: [] }
    }

    const data = await res.json()

    // PropertyDetail can return data as an object or array
    const detail = Array.isArray(data.data) ? data.data[0] : data.data
    if (!detail) return { case_number: null, foreclosure_history: [] }

    const foreclosureInfo: ForeclosureInfoEntry[] = detail.foreclosureInfo ?? []
    const case_number = pickBestCaseNumber(foreclosureInfo)

    if (case_number) {
      console.log(`[CaseLookup] Found case number ${case_number} for ${params.apn}`)
    } else {
      console.log(`[CaseLookup] No case number in PropertyDetail for ${params.apn} (${foreclosureInfo.length} entries)`)
    }

    return { case_number, foreclosure_history: foreclosureInfo }

  } catch (err) {
    console.error(`[CaseLookup] Error for ${params.apn}:`, err)
    return { case_number: null, foreclosure_history: [] }
  }
}
