/**
 * REAPI Pre-Foreclosure Ingestion Engine
 *
 * Replaces the county OR SFTP/web scrapers with a single REAPI-powered
 * pipeline. RealEstateAPI's /v2/PropertySearch endpoint is pre-filtered
 * for pre_foreclosure, foreclosure, and auction records with daily updates.
 *
 * Flow per county:
 *   1. Fetch all distress records via paginated REAPI calls (250/page)
 *   2. Dedup by APN (folio_number) — skip if already in DB with same flags
 *   3. Upsert properties table (rich data — no resolver step needed)
 *   4. Create leads entry if not already in pipeline
 *   5. Log to scraper_runs
 *
 * Covers: Broward · Miami-Dade · Palm Beach
 */

import { createClient } from '@supabase/supabase-js'
import { detectEntityType } from '@/lib/scrapers/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export type REAPICounty = 'broward' | 'miami-dade' | 'palm-beach'

/** Raw property record from REAPI /v2/PropertySearch */
interface REAPIProperty {
  propertyId:            string | number
  apn?:                  string
  address?: {
    address?: string
    street?:  string
    city?:    string
    state?:   string
    zip?:     string
    county?:  string
    fips?:    string
  }
  mailAddress?: {
    address?: string
    city?:    string
    state?:   string
    zip?:     string
  }
  owner1FirstName?:      string
  owner1LastName?:       string
  owner2FirstName?:      string
  owner2LastName?:       string
  companyName?:          string
  bedrooms?:             number | null
  bathrooms?:            number | null
  squareFeet?:           number | null
  lotSquareFeet?:        number | null
  yearBuilt?:            number | null
  assessedValue?:        number | null
  estimatedValue?:       number | null
  openMortgageBalance?:  number | null
  equityPercent?:        number | null
  estimatedEquity?:      number | null
  lenderName?:           string | null
  propertyType?:         string | null
  propertyUse?:          string | null
  noticeType?:           string | null
  preForeclosure?:       boolean
  foreclosure?:          boolean
  auction?:              boolean
  auctionDate?:          string | null
  lastUpdateDate?:       string | null
  recordingDate?:        string | null
  latitude?:             number | null
  longitude?:            number | null
  suggestedRent?:        string | number | null
  ownerOccupied?:        boolean
  absenteeOwner?:        boolean
  outOfStateAbsenteeOwner?: boolean
  freeClear?:            boolean
  highEquity?:           boolean
  vacant?:               boolean
  pool?:                 boolean
  hoa?:                  boolean
  neighborhood?: { name?: string }
  mlsStatus?:            string | null
  mlsListingPrice?:      number | null
  mlsActive?:            boolean
}

interface REAPISearchResponse {
  statusCode?:   number
  statusMessage?: string
  message?:      string
  data?:         REAPIProperty[]
  resultCount?:  number
  resultIndex?:  number
  recordCount?:  number
}

export interface REAPIIngestionResult {
  county:      REAPICounty
  fetched:     number
  inserted:    number
  updated:     number
  skipped:     number
  errors:      number
  source:      string
}

export interface REAPIRunResult {
  run_id:         string
  started_at:     string
  completed_at:   string
  duration_ms:    number
  total_inserted: number
  total_updated:  number
  total_skipped:  number
  total_errors:   number
  counties:       REAPIIngestionResult[]
}

// ─── Config ───────────────────────────────────────────────────────────────────

const REAPI_BASE  = 'https://api.realestateapi.com/v2'
const PAGE_SIZE   = 250   // REAPI max is 250

/** Maps our county ID to REAPI's county name format */
const COUNTY_LABEL: Record<REAPICounty, string> = {
  'broward':     'Broward',
  'miami-dade':  'Miami-Dade',
  'palm-beach':  'Palm Beach',
}

const DATA_SOURCE_LABEL: Record<REAPICounty, string> = {
  'broward':    'Broward REAPI',
  'miami-dade': 'Miami-Dade REAPI',
  'palm-beach': 'PBC REAPI',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Returns the last business day (Mon–Fri) as YYYY-MM-DD */
function lastBusinessDayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const dow = d.getDay()
  if (dow === 0) d.setDate(d.getDate() - 2)  // Sun → Fri
  if (dow === 6) d.setDate(d.getDate() - 1)  // Sat → Fri
  return d.toISOString().slice(0, 10)
}

/** Equity tier from percentage */
function equityTier(pct: number | null | undefined): 'High' | 'Medium' | 'Low' | 'None' {
  if (pct == null || pct <= 0) return 'None'
  if (pct >= 50) return 'High'
  if (pct >= 20) return 'Medium'
  return 'Low'
}

/** Build full owner name from REAPI fields */
function ownerName(p: REAPIProperty): string {
  const first = [p.owner1FirstName, p.owner1LastName].filter(Boolean).join(' ').trim()
  const second = [p.owner2FirstName, p.owner2LastName].filter(Boolean).join(' ').trim()
  if (first && second) return `${first} & ${second}`
  return first || p.companyName || ''
}

/** Derive county from address.county string returned by REAPI */
function countyFromAddress(raw: string | undefined): REAPICounty | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.includes('broward'))    return 'broward'
  if (lower.includes('miami'))      return 'miami-dade'
  if (lower.includes('palm beach')) return 'palm-beach'
  return null
}

/** Map REAPI noticeType → foreclosure_type code */
function foreclosureType(p: REAPIProperty): string {
  if (p.auction)      return 'A'
  if (p.foreclosure)  return 'F'
  return 'P'   // pre-foreclosure / lis pendens
}

/** Normalise suggestedRent → number or null */
function parseSuggestedRent(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

/** Parse REAPI's "YYYY-MM-DD HH:MM:SS UTC" or "YYYY-MM-DD" to date-only string */
function toDateStr(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw.slice(0, 10)   // first 10 chars = YYYY-MM-DD
}

// ─── REAPI fetcher (paginated) ────────────────────────────────────────────────

/**
 * Fetches ALL distress records for one county + distress type.
 * Paginates automatically using resultIndex until all pages are retrieved.
 */
async function fetchDistressRecords(
  county:      REAPICounty,
  distressKey: 'pre_foreclosure' | 'foreclosure' | 'auction',
  dateMin:     string,
  dateMax:     string
): Promise<REAPIProperty[]> {
  const key = process.env.REAPI_KEY
  if (!key) throw new Error('REAPI_KEY environment variable is not set')

  const dateFilterKey = distressKey === 'pre_foreclosure' ? 'pre_foreclosure_date_min'
                      : distressKey === 'foreclosure'      ? 'foreclosure_date_min'
                      : 'auction_date_min'
  const dateFilterKeyMax = dateFilterKey.replace('_min', '_max')

  const records: REAPIProperty[] = []
  let resultIndex = 1

  while (true) {
    const body: Record<string, unknown> = {
      state:           'FL',
      county:          COUNTY_LABEL[county],
      [distressKey]:   true,
      [dateFilterKey]: dateMin,
      [dateFilterKeyMax]: dateMax,
      size:            PAGE_SIZE,
    }
    if (resultIndex > 1) body.resultIndex = resultIndex

    const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    key,
      },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`REAPI HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const data: REAPISearchResponse = await res.json()

    if (data.statusCode && data.statusCode !== 200) {
      throw new Error(`REAPI error ${data.statusCode}: ${data.message ?? data.statusMessage}`)
    }

    const page = data.data ?? []
    records.push(...page)

    const total    = data.resultCount ?? 0
    const nextIdx  = data.resultIndex ?? 1
    const returned = data.recordCount ?? page.length

    console.log(`[REAPI] ${county}/${distressKey} page resultIndex=${resultIndex}: ${returned} records (${records.length}/${total} total)`)

    // Stop when we've fetched everything
    if (records.length >= total || returned < PAGE_SIZE || page.length === 0) break

    resultIndex = nextIdx
  }

  return records
}

// ─── Single-property ingestion ────────────────────────────────────────────────

async function ingestProperty(
  supabase:  ReturnType<typeof getSupabase>,
  p:         REAPIProperty,
  county:    REAPICounty,
  runId:     string
): Promise<'inserted' | 'updated' | 'skipped' | 'error'> {
  const apn = p.apn?.trim()
  if (!apn) return 'skipped'   // no folio → can't dedup

  // case_number is intentionally null — REAPI doesn't provide county court case numbers
  // The folio_number (APN) is the primary dedup key for REAPI-sourced properties
  const addr  = p.address ?? {}
  const mail  = p.mailAddress ?? {}
  const oName = ownerName(p)

  // Determine which county we're in (double-check from address if available)
  const addrCounty = countyFromAddress(addr.county)
  const effectiveCounty = addrCounty ?? county

  const equityPct = p.equityPercent ?? null
  const debtAmt   = p.openMortgageBalance ?? null
  const mktVal    = p.estimatedValue ?? null
  const equityAmt = (mktVal != null && debtAmt != null) ? Math.max(0, mktVal - debtAmt) : (p.estimatedEquity ?? null)

  // file_date: use lastUpdateDate (REAPI's last update, approximates LP date)
  // For auction, prefer auctionDate if available
  const fileDate = p.auction && p.auctionDate
    ? toDateStr(p.auctionDate)
    : toDateStr(p.lastUpdateDate)

  const payload = {
    scraper_run_id:     runId,
    source:             'reapi',
    county:             effectiveCounty,
    data_source:        DATA_SOURCE_LABEL[effectiveCounty],
    case_number:        null,   // not available from REAPI — county clerk index only
    file_date:          fileDate,
    plaintiff:          p.lenderName ?? null,
    lender_name:        p.lenderName ?? null,
    mortgagor:          oName || null,
    foreclosure_amount: debtAmt ?? null,
    foreclosure_type:   foreclosureType(p),

    // Distress flags
    is_pre_foreclosure: p.preForeclosure ?? false,
    is_foreclosure:     p.foreclosure    ?? false,
    is_auction:         p.auction        ?? false,
    is_probate:         false,
    is_tax_deed:        false,
    is_divorce:         false,
    is_reo:             false,
    multiple_liens:     false,
    free_clear:         p.freeClear     ?? false,
    high_equity:        p.highEquity    ?? (equityTier(equityPct) === 'High'),

    // Property identity
    folio_number:       apn,
    owner_name:         oName || null,
    property_address:   addr.address ?? (`${addr.street ?? ''} ${addr.city ?? ''} ${addr.state ?? 'FL'} ${addr.zip ?? ''}`.trim() || null),
    city:               addr.city ?? null,
    zip:                addr.zip  ?? null,
    state:              'FL',
    entity_type:        detectEntityType(oName),

    // Property details
    beds:               p.bedrooms   ?? null,
    baths:              p.bathrooms  ?? null,
    year_built:         p.yearBuilt  ?? null,
    living_area:        p.squareFeet ?? null,
    lot_size:           p.lotSquareFeet ?? null,
    property_type:      p.propertyType ?? p.propertyUse ?? null,

    // Financials
    assessed_value:     p.assessedValue ?? null,
    market_value:       mktVal,
    known_debt:         debtAmt,
    equity_percentage:  equityPct,
    equity_dollar_amount: equityAmt,
    equity_tier:        equityTier(equityPct),

    // Occupancy / status
    homestead:          p.ownerOccupied  ?? null,
    vacant:             p.vacant         ?? null,
    absentee_owner:     p.absenteeOwner  ?? null,

    // Geo
    latitude:           p.latitude  ?? null,
    longitude:          p.longitude ?? null,

    // Misc
    suggested_rent:     parseSuggestedRent(p.suggestedRent),
    subdivision_name:   p.neighborhood?.name ?? null,

    // Raw data blob
    raw_reapi:          p as object,

    updated_at:         new Date().toISOString(),
  }

  // ── Dedup by folio_number ──────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('properties')
    .select('id, is_pre_foreclosure, is_foreclosure, is_auction')
    .eq('folio_number', apn)
    .maybeSingle()

  let propertyId: string

  if (existing) {
    // Already in DB. Update distress flags and financials.
    const { error: updErr } = await supabase
      .from('properties')
      .update({
        is_pre_foreclosure: payload.is_pre_foreclosure || existing.is_pre_foreclosure,
        is_foreclosure:     payload.is_foreclosure     || existing.is_foreclosure,
        is_auction:         payload.is_auction         || existing.is_auction,
        file_date:          payload.file_date,
        plaintiff:          payload.plaintiff,
        lender_name:        payload.lender_name,
        foreclosure_amount: payload.foreclosure_amount,
        foreclosure_type:   payload.foreclosure_type,
        market_value:       payload.market_value,
        known_debt:         payload.known_debt,
        equity_percentage:  payload.equity_percentage,
        equity_dollar_amount: payload.equity_dollar_amount,
        equity_tier:        payload.equity_tier,
        high_equity:        payload.high_equity,
        raw_reapi:          payload.raw_reapi,
        updated_at:         payload.updated_at,
      })
      .eq('id', existing.id)

    if (updErr) {
      console.error(`[REAPI Engine] update failed for folio ${apn}:`, updErr.message)
      return 'error'
    }
    propertyId = existing.id
  } else {
    // New property
    const { data: newProp, error: insErr } = await supabase
      .from('properties')
      .insert([payload])
      .select('id')
      .single()

    if (insErr || !newProp) {
      console.error(`[REAPI Engine] insert failed for folio ${apn}:`, insErr?.message)
      return 'error'
    }
    propertyId = newProp.id
  }

  // ── Ensure a leads entry exists ────────────────────────────────────────────
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id')
    .eq('property_id', propertyId)
    .maybeSingle()

  if (!existingLead) {
    const { error: leadErr } = await supabase
      .from('leads')
      .insert([{
        property_id: propertyId,
        status:      'new',
        source:      'reapi',
      }])

    if (leadErr) {
      console.warn(`[REAPI Engine] leads insert failed for ${propertyId}:`, leadErr.message)
      // Don't count as error — property was saved
    }
  }

  return existing ? 'updated' : 'inserted'
}

// ─── County-level ingestion ───────────────────────────────────────────────────

async function ingestCounty(
  supabase:  ReturnType<typeof getSupabase>,
  county:    REAPICounty,
  dateMin:   string,
  dateMax:   string,
  runId:     string
): Promise<REAPIIngestionResult> {
  const result: REAPIIngestionResult = {
    county,
    fetched:  0,
    inserted: 0,
    updated:  0,
    skipped:  0,
    errors:   0,
    source:   `REAPI:${dateMin}`,
  }

  // Fetch all distress types
  const distressTypes: Array<'pre_foreclosure' | 'foreclosure' | 'auction'> = [
    'pre_foreclosure',
    'foreclosure',
    'auction',
  ]

  const allRecords: REAPIProperty[] = []
  const seenAPNs = new Set<string>()

  for (const dtype of distressTypes) {
    try {
      const records = await fetchDistressRecords(county, dtype, dateMin, dateMax)
      // Deduplicate across distress types (same property can be pre_fc + foreclosure)
      for (const r of records) {
        const apn = r.apn?.trim()
        if (apn && !seenAPNs.has(apn)) {
          seenAPNs.add(apn)
          allRecords.push(r)
        }
      }
    } catch (err) {
      console.error(`[REAPI Engine] ${county}/${dtype} fetch failed:`, err)
      result.errors++
    }
  }

  result.fetched = allRecords.length
  console.log(`[REAPI Engine] ${county}: ${result.fetched} unique records after dedup`)

  // Ingest each record
  for (const p of allRecords) {
    const outcome = await ingestProperty(supabase, p, county, runId)
    if (outcome === 'inserted') result.inserted++
    else if (outcome === 'updated') result.updated++
    else if (outcome === 'skipped') result.skipped++
    else result.errors++
  }

  return result
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Run the REAPI ingestion pipeline for the given counties and date range.
 *
 * @param counties  — defaults to all three South FL counties
 * @param dateMin   — ISO date string, defaults to last business day
 * @param dateMax   — ISO date string, defaults to last business day
 * @param existingRunId — use an existing scraper_runs record if provided
 */
export async function runREAPIIngestion(
  counties:       REAPICounty[] = ['broward', 'miami-dade', 'palm-beach'],
  dateMin?:       string,
  dateMax?:       string,
  existingRunId?: string
): Promise<REAPIRunResult> {
  const supabase    = getSupabase()
  const startedAt   = new Date()
  const startedISO  = startedAt.toISOString()
  const targetDate  = lastBusinessDayISO()
  const dMin        = dateMin ?? targetDate
  const dMax        = dateMax ?? targetDate

  console.log(`[REAPI Engine] Starting ingestion for ${counties.join(', ')} | date range: ${dMin} → ${dMax}`)

  // ── Create / reuse scraper_runs record ────────────────────────────────────
  let runId: string

  if (existingRunId) {
    runId = existingRunId
  } else {
    const { data: run, error: runErr } = await supabase
      .from('scraper_runs')
      .insert([{ triggered_by: 'reapi-ingestion', status: 'running' }])
      .select()
      .single()

    if (runErr || !run) {
      throw new Error(`Failed to create scraper_runs record: ${runErr?.message}`)
    }
    runId = run.id
  }

  // ── Run counties in parallel ──────────────────────────────────────────────
  const settled = await Promise.allSettled(
    counties.map(c => ingestCounty(supabase, c, dMin, dMax, runId))
  )

  const countyResults: REAPIIngestionResult[] = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    console.error(`[REAPI Engine] ${counties[i]} runner threw:`, r.reason)
    return {
      county:   counties[i],
      fetched:  0, inserted: 0, updated: 0, skipped: 0, errors: 1,
      source:   'error',
    }
  })

  const completedAt  = new Date()
  const durationMs   = completedAt.getTime() - startedAt.getTime()
  const totIns       = countyResults.reduce((s, r) => s + r.inserted, 0)
  const totUpd       = countyResults.reduce((s, r) => s + r.updated,  0)
  const totSkip      = countyResults.reduce((s, r) => s + r.skipped,  0)
  const totErr       = countyResults.reduce((s, r) => s + r.errors,   0)

  // ── Update scraper_runs ───────────────────────────────────────────────────
  await supabase.from('scraper_runs').update({
    status:           totErr > 0 && totIns + totUpd === 0 ? 'error' : 'success',
    completed_at:     completedAt.toISOString(),
    broward_count:    countyResults.find(r => r.county === 'broward')?.inserted  ?? 0,
    miami_dade_count: countyResults.find(r => r.county === 'miami-dade')?.inserted ?? 0,
    pbc_count:        countyResults.find(r => r.county === 'palm-beach')?.inserted ?? 0,
    total_records:    totIns + totUpd,
    duration_ms:      durationMs,
  }).eq('id', runId)

  const runResult: REAPIRunResult = {
    run_id:         runId,
    started_at:     startedISO,
    completed_at:   completedAt.toISOString(),
    duration_ms:    durationMs,
    total_inserted: totIns,
    total_updated:  totUpd,
    total_skipped:  totSkip,
    total_errors:   totErr,
    counties:       countyResults,
  }

  console.log(`[REAPI Engine] Done — ${totIns} inserted, ${totUpd} updated, ${totErr} errors (${durationMs}ms)`)
  return runResult
}
