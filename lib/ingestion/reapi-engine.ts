/**
 * REAPI Pre-Foreclosure Ingestion Engine — Gateway-enforced
 *
 * Every REAPI PropertySearch page is authorized through ProviderGateway before
 * the network call is made.  Budget exhaustion pauses the run gracefully — no
 * records are lost and no un-reserved call is ever made.
 *
 * Pool:      background_operations (BACKGROUND_CONTEXT)
 * Credits:   0 — background jobs never charge customer credits
 * Cost:      5¢/page  (property_search_criteria feature)
 * Idempotency: request_id = ing-{runId}-{county}-{distressType}-p{pageNum}
 *
 * Run controls (all configurable, with safe defaults):
 *   maxCallsPerRun       — hard cap on authorize+fetch cycles
 *   maxVendorCostCents   — hard cap on estimated spend per run
 *   maxRecordsPerRun     — stop after N records processed
 *   maxPagesPerDistressType — per (county × distressType) page limit
 *   timeoutMs            — wall-clock run timeout
 *
 * Checkpoint / resume:
 *   A checkpoint is emitted in REAPIRunResult.checkpoint whenever the run is
 *   paused (budget, limit, timeout).  Pass it back as resumeFrom to continue
 *   exactly where processing left off — previously authorized pages are never
 *   re-authorized.
 */

import { createClient } from '@supabase/supabase-js'
import { detectEntityType } from '@/lib/scrapers/utils'
import { markModuleRefreshed } from '@/lib/propertyService'
import { recordFieldSources, logDSOERequest } from '@/lib/dsoe'
import { providerGateway } from '@/lib/billing/providerGateway'
import { pricingEngine } from '@/lib/billing/pricingEngine'
import { BACKGROUND_CONTEXT } from '@/lib/billing/gatewayContext'

// ─── Types ────────────────────────────────────────────────────────────────────

export type REAPICounty   = 'broward' | 'miami-dade' | 'palm-beach'
export type DistressType  = 'pre_foreclosure' | 'foreclosure' | 'auction'

/** Raw property record from REAPI /v2/PropertySearch */
interface REAPIProperty {
  propertyId:            string | number
  apn?:                  string
  address?: {
    address?: string; street?: string; city?: string
    state?: string; zip?: string; county?: string; fips?: string
  }
  mailAddress?: { address?: string; city?: string; state?: string; zip?: string }
  owner1FirstName?: string; owner1LastName?: string
  owner2FirstName?: string; owner2LastName?: string
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
  neighborhood?:         { name?: string }
  mlsStatus?:            string | null
  mlsListingPrice?:      number | null
  mlsActive?:            boolean
}

interface REAPISearchResponse {
  statusCode?:    number
  statusMessage?: string
  message?:       string
  data?:          REAPIProperty[]
  resultCount?:   number
  resultIndex?:   number
  recordCount?:   number
}

/** Where a paused run should resume. */
export interface IngestionCheckpoint {
  county:        REAPICounty
  distress_type: DistressType
  next_page_index: number
}

export interface IngestionRunConfig {
  /** Max total authorize+fetch cycles for the whole run (across all counties). Default: 60. */
  maxCallsPerRun:          number
  /** Max total estimated vendor spend cents for the whole run. Default: 300 (= $3.00). */
  maxVendorCostCents:      number
  /** Max property records processed for the whole run. Default: 15_000. */
  maxRecordsPerRun:        number
  /** Max pages fetched per (county × distressType) segment. Default: 20. */
  maxPagesPerDistressType: number
  /** Wall-clock timeout in ms. Default: 240_000 (4 min). */
  timeoutMs:               number
}

export const DEFAULT_INGESTION_CONFIG: IngestionRunConfig = {
  maxCallsPerRun:          60,
  maxVendorCostCents:      300,
  maxRecordsPerRun:        15_000,
  maxPagesPerDistressType: 20,
  timeoutMs:               240_000,
}

export const INGESTION_FEATURE_KEY = 'property_search_criteria'

export interface REAPIIngestionResult {
  county:               REAPICounty
  distress_type?:       DistressType  // null when summarising across all types
  fetched:              number
  inserted:             number
  updated:              number
  skipped:              number
  errors:               number
  calls_attempted:      number
  calls_completed:      number
  estimated_cost_cents: number
  actual_cost_cents:    number
  source:               string
}

export interface REAPIRunResult {
  run_id:               string
  job_id:               string
  started_at:           string
  completed_at:         string
  duration_ms:          number
  total_inserted:       number
  total_updated:        number
  total_skipped:        number
  total_errors:         number
  calls_attempted:      number
  calls_completed:      number
  estimated_cost_cents: number
  actual_cost_cents:    number
  records_processed:    number
  paused:               boolean
  pause_reason?:        string
  checkpoint?:          IngestionCheckpoint
  counties:             REAPIIngestionResult[]
}

// ─── Config ───────────────────────────────────────────────────────────────────

const REAPI_BASE = 'https://api.realestateapi.com/v2'
const PAGE_SIZE  = 250

const COUNTY_LABEL: Record<REAPICounty, string> = {
  'broward':    'Broward',
  'miami-dade': 'Miami-Dade',
  'palm-beach': 'Palm Beach',
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

function lastBusinessDayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const dow = d.getDay()
  if (dow === 0) d.setDate(d.getDate() - 2)
  if (dow === 6) d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function equityTier(pct: number | null | undefined): 'High' | 'Medium' | 'Low' | 'None' {
  if (pct == null || pct <= 0) return 'None'
  if (pct >= 50) return 'High'
  if (pct >= 20) return 'Medium'
  return 'Low'
}

function ownerName(p: REAPIProperty): string {
  const first  = [p.owner1FirstName, p.owner1LastName].filter(Boolean).join(' ').trim()
  const second = [p.owner2FirstName, p.owner2LastName].filter(Boolean).join(' ').trim()
  if (first && second) return `${first} & ${second}`
  return first || p.companyName || ''
}

function countyFromAddress(raw: string | undefined): REAPICounty | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.includes('broward'))    return 'broward'
  if (lower.includes('miami'))      return 'miami-dade'
  if (lower.includes('palm beach')) return 'palm-beach'
  return null
}

function foreclosureType(p: REAPIProperty): string {
  if (p.auction)     return 'A'
  if (p.foreclosure) return 'F'
  return 'P'
}

function parseSuggestedRent(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

function toDateStr(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw.slice(0, 10)
}

// ─── Single-page fetcher ──────────────────────────────────────────────────────

interface PageResult {
  records:    REAPIProperty[]
  total:      number
  returned:   number
  nextIndex:  number
}

async function fetchDistressPage(
  apiKey:      string,
  county:      REAPICounty,
  distressKey: DistressType,
  dateMin:     string,
  dateMax:     string,
  pageIndex:   number,
): Promise<PageResult> {
  const dateField    = distressKey === 'pre_foreclosure' ? 'pre_foreclosure_date_min'
                     : distressKey === 'foreclosure'      ? 'foreclosure_date_min'
                     : 'auction_date_min'
  const dateFieldMax = dateField.replace('_min', '_max')

  const body: Record<string, unknown> = {
    state:          'FL',
    county:         COUNTY_LABEL[county],
    [distressKey]:  true,
    [dateField]:    dateMin,
    [dateFieldMax]: dateMax,
    size:           PAGE_SIZE,
  }
  if (pageIndex > 1) body.resultIndex = pageIndex

  const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
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
  return {
    records:   page,
    total:     data.resultCount ?? 0,
    returned:  data.recordCount ?? page.length,
    nextIndex: data.resultIndex ?? pageIndex + PAGE_SIZE,
  }
}

// ─── Single-property ingestion ────────────────────────────────────────────────

async function ingestProperty(
  supabase:         ReturnType<typeof getSupabase>,
  p:                REAPIProperty,
  county:           REAPICounty,
  runId:            string,
  actualCostCents:  number,
): Promise<'inserted' | 'updated' | 'skipped' | 'error'> {
  const apn = p.apn?.trim()
  if (!apn) return 'skipped'

  const addr  = p.address ?? {}
  const oName = ownerName(p)
  const addrCounty = countyFromAddress(addr.county)
  const effectiveCounty = addrCounty ?? county

  const equityPct = p.equityPercent ?? null
  const debtAmt   = p.openMortgageBalance ?? null
  const mktVal    = p.estimatedValue ?? null
  const equityAmt = (mktVal != null && debtAmt != null) ? Math.max(0, mktVal - debtAmt) : (p.estimatedEquity ?? null)

  const fileDate = p.auction && p.auctionDate
    ? toDateStr(p.auctionDate) : toDateStr(p.lastUpdateDate)

  const payload = {
    scraper_run_id:     runId,
    source:             'reapi',
    county:             effectiveCounty,
    data_source:        DATA_SOURCE_LABEL[effectiveCounty],
    case_number:        null,
    file_date:          fileDate,
    plaintiff:          p.lenderName ?? null,
    lender_name:        p.lenderName ?? null,
    mortgagor:          oName || null,
    foreclosure_amount: debtAmt ?? null,
    foreclosure_type:   foreclosureType(p),

    is_pre_foreclosure: p.preForeclosure ?? false,
    is_foreclosure:     p.foreclosure    ?? false,
    is_auction:         p.auction        ?? false,
    is_probate:         false, is_tax_deed: false, is_divorce: false,
    is_reo:             false, multiple_liens: false,
    free_clear:         p.freeClear   ?? false,
    high_equity:        p.highEquity  ?? (equityTier(equityPct) === 'High'),

    folio_number:       apn,
    owner_name:         oName || null,
    property_address:   addr.address ?? (`${addr.street ?? ''} ${addr.city ?? ''} ${addr.state ?? 'FL'} ${addr.zip ?? ''}`.trim() || null),
    city:               addr.city ?? null,
    zip:                addr.zip  ?? null,
    state:              'FL',
    entity_type:        detectEntityType(oName),

    beds:               p.bedrooms      ?? null,
    baths:              p.bathrooms     ?? null,
    year_built:         p.yearBuilt     ?? null,
    living_area:        p.squareFeet    ?? null,
    lot_size:           p.lotSquareFeet ?? null,
    property_type:      p.propertyType  ?? p.propertyUse ?? null,

    assessed_value:       p.assessedValue ?? null,
    market_value:         mktVal,
    known_debt:           debtAmt,
    equity_percentage:    equityPct,
    equity_dollar_amount: equityAmt,
    equity_tier:          equityTier(equityPct),

    homestead:          p.ownerOccupied ?? null,
    vacant:             p.vacant        ?? null,
    absentee_owner:     p.absenteeOwner ?? null,

    latitude:           p.latitude  ?? null,
    longitude:          p.longitude ?? null,
    suggested_rent:     parseSuggestedRent(p.suggestedRent),
    subdivision_name:   p.neighborhood?.name ?? null,
    raw_reapi:          p as object,
    updated_at:         new Date().toISOString(),
  }

  const { data: existing } = await supabase
    .from('properties')
    .select('id, is_pre_foreclosure, is_foreclosure, is_auction, foreclosure_status_override')
    .eq('folio_number', apn)
    .maybeSingle()

  let propertyId: string

  if (existing) {
    const prevState  = (existing.is_foreclosure || existing.is_auction) ? 'Active' : existing.is_pre_foreclosure ? 'Pending' : null
    const newState   = (payload.is_foreclosure  || payload.is_auction)  ? 'Active' : payload.is_pre_foreclosure  ? 'Pending' : null
    const reapiChanged = !!(existing.foreclosure_status_override && prevState !== newState)

    const { error: updErr } = await supabase
      .from('properties')
      .update({
        is_pre_foreclosure: payload.is_pre_foreclosure || existing.is_pre_foreclosure,
        is_foreclosure:     payload.is_foreclosure     || existing.is_foreclosure,
        is_auction:         payload.is_auction         || existing.is_auction,
        ...(reapiChanged ? { foreclosure_reapi_changed: true } : {}),
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

  void Promise.all([
    markModuleRefreshed(propertyId, 'foreclosure', 'reapi-ingest'),
    markModuleRefreshed(propertyId, 'valuation',   'reapi-ingest'),
    markModuleRefreshed(propertyId, 'mortgage',    'reapi-ingest'),
    markModuleRefreshed(propertyId, 'ownership',   'reapi-ingest'),
    markModuleRefreshed(propertyId, 'rental',      'reapi-ingest'),
  ]).catch(() => {})

  void recordFieldSources(propertyId, {
    owner_name: payload.owner_name, folio: payload.folio_number,
    beds: payload.beds, baths: payload.baths, year_built: payload.year_built,
    living_area: payload.living_area, lot_size: payload.lot_size,
    assessed_value: payload.assessed_value, market_value: payload.market_value,
    homestead: payload.homestead, absentee_owner: payload.absentee_owner,
  }, { source: 'reapi', sourceType: 'paid', sourceLabel: 'RealEstateAPI', confidence: 95 })

  logDSOERequest({
    propertyId,
    tier: 3, source: 'reapi', fieldsResolved: 11, cacheHits: 0, countyHits: 0,
    premiumHits: 11, costCents: actualCostCents, durationMs: 0,
  })

  const { data: existingLead } = await supabase
    .from('leads').select('id').eq('property_id', propertyId).maybeSingle()

  if (!existingLead) {
    await supabase.from('leads')
      .insert([{ property_id: propertyId, status: 'new', source: 'reapi' }])
      .then(({ error }) => {
        if (error) console.warn(`[REAPI Engine] leads insert failed for ${propertyId}:`, error.message)
      })
  }

  return existing ? 'updated' : 'inserted'
}

// ─── Run-level state ──────────────────────────────────────────────────────────

interface RunState {
  callsAttempted:      number
  callsCompleted:      number
  estimatedCostCents:  number
  actualCostCents:     number
  recordsProcessed:    number
  paused:              boolean
  pauseReason:         string | undefined
  checkpoint:          IngestionCheckpoint | undefined
}

// ─── County + distress-type segment ingestion ─────────────────────────────────

async function ingestSegment(
  supabase:    ReturnType<typeof getSupabase>,
  apiKey:      string,
  county:      REAPICounty,
  distressType: DistressType,
  dateMin:     string,
  dateMax:     string,
  runId:       string,
  startPageIndex: number,
  config:      IngestionRunConfig,
  runState:    RunState,
  startTime:   number,
  pricing:     { expected_vendor_cost_cents: number },
): Promise<REAPIIngestionResult> {
  const result: REAPIIngestionResult = {
    county,
    distress_type:        distressType,
    fetched:              0,
    inserted:             0,
    updated:              0,
    skipped:              0,
    errors:               0,
    calls_attempted:      0,
    calls_completed:      0,
    estimated_cost_cents: 0,
    actual_cost_cents:    0,
    source:               `REAPI:${dateMin}`,
  }

  const seenAPNs = new Set<string>()
  let pageIndex  = startPageIndex
  let pageNum    = 1

  while (pageNum <= config.maxPagesPerDistressType) {
    // ── Run-level limit checks ────────────────────────────────────────────
    if (runState.callsAttempted >= config.maxCallsPerRun) {
      runState.paused     = true
      runState.pauseReason = 'max_calls_reached'
      runState.checkpoint  = { county, distress_type: distressType, next_page_index: pageIndex }
      console.log(`[REAPI Engine] max_calls_reached at ${county}/${distressType} page ${pageIndex}`)
      break
    }
    if (runState.estimatedCostCents + pricing.expected_vendor_cost_cents > config.maxVendorCostCents) {
      runState.paused      = true
      runState.pauseReason = 'max_cost_reached'
      runState.checkpoint  = { county, distress_type: distressType, next_page_index: pageIndex }
      console.log(`[REAPI Engine] max_cost_reached at ${county}/${distressType} page ${pageIndex}`)
      break
    }
    if (runState.recordsProcessed >= config.maxRecordsPerRun) {
      runState.paused      = true
      runState.pauseReason = 'max_records_reached'
      runState.checkpoint  = { county, distress_type: distressType, next_page_index: pageIndex }
      console.log(`[REAPI Engine] max_records_reached at ${county}/${distressType} page ${pageIndex}`)
      break
    }
    if (Date.now() - startTime >= config.timeoutMs) {
      runState.paused      = true
      runState.pauseReason = 'timeout'
      runState.checkpoint  = { county, distress_type: distressType, next_page_index: pageIndex }
      console.log(`[REAPI Engine] timeout at ${county}/${distressType} page ${pageIndex}`)
      break
    }

    // ── Reserve budget for this page ──────────────────────────────────────
    // Idempotency: same run + county + distressType + page = same request_id
    const request_id = `ing-${runId}-${county}-${distressType}-p${pageIndex}`
    const start = Date.now()

    const auth = await providerGateway.authorize({
      request_id,
      account_id:           BACKGROUND_CONTEXT.account_id,
      feature_key:          INGESTION_FEATURE_KEY,
      provider_key:         'reapi',
      pool_key:             BACKGROUND_CONTEXT.pool_key,
      estimated_cost_cents: pricing.expected_vendor_cost_cents,
      credit_cost:          0,   // background — never charges customer credits
      is_zero_cost_feature: false,
    })

    runState.callsAttempted++
    result.calls_attempted++

    if (!auth.success) {
      const tag = auth.error_code === 'pool_exhausted'
        ? 'background_paused_by_budget' : (auth.error_code ?? 'auth_failed')
      console.warn(`[REAPI Engine] ${county}/${distressType} page ${pageIndex} auth blocked: ${tag}`)

      runState.paused      = true
      runState.pauseReason = tag
      runState.checkpoint  = { county, distress_type: distressType, next_page_index: pageIndex }
      break
    }

    runState.estimatedCostCents  += pricing.expected_vendor_cost_cents
    result.estimated_cost_cents   += pricing.expected_vendor_cost_cents

    // ── Fetch page ────────────────────────────────────────────────────────
    try {
      const fetched = await fetchDistressPage(apiKey, county, distressType, dateMin, dateMax, pageIndex)
      const elapsed = Date.now() - start

      runState.callsCompleted++
      result.calls_completed++

      // Finalize budget reservation with actual cost
      providerGateway.finalize({
        request_id,
        actual_cost_cents: pricing.expected_vendor_cost_cents,
        success:           true,
        duration_ms:       elapsed,
      }).catch(e => console.error('[REAPI Engine] finalize error:', e))

      runState.actualCostCents  += pricing.expected_vendor_cost_cents
      result.actual_cost_cents  += pricing.expected_vendor_cost_cents

      console.log(`[REAPI Engine] ${county}/${distressType} page ${pageIndex}: ${fetched.returned} records (${fetched.records.length + result.fetched}/${fetched.total} total)`)

      // ── Ingest records ────────────────────────────────────────────────
      for (const p of fetched.records) {
        const apn = p.apn?.trim()
        if (apn && seenAPNs.has(apn)) {
          result.skipped++
          continue
        }
        if (apn) seenAPNs.add(apn)

        const outcome = await ingestProperty(
          supabase, p, county, runId, pricing.expected_vendor_cost_cents
        )
        result.fetched++
        runState.recordsProcessed++

        if (outcome === 'inserted') result.inserted++
        else if (outcome === 'updated') result.updated++
        else if (outcome === 'skipped') result.skipped++
        else result.errors++
      }

      // ── Stop conditions ───────────────────────────────────────────────
      if (result.fetched >= fetched.total || fetched.returned < PAGE_SIZE || fetched.records.length === 0) break
      pageIndex = fetched.nextIndex
      pageNum++

    } catch (err) {
      const elapsed = Date.now() - start
      console.error(`[REAPI Engine] ${county}/${distressType} page ${pageIndex} fetch failed:`, err)

      providerGateway.finalize({
        request_id,
        actual_cost_cents: 0,
        success:           false,
        error_code:        'provider_error',
        duration_ms:       elapsed,
      }).catch(() => {})

      // Reconcile cost: this page didn't succeed
      runState.estimatedCostCents  -= pricing.expected_vendor_cost_cents
      result.estimated_cost_cents  -= pricing.expected_vendor_cost_cents

      result.errors++
      // Preserve checkpoint so retry can resume from this page
      runState.checkpoint = { county, distress_type: distressType, next_page_index: pageIndex }
      break
    }
  }

  return result
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Run the REAPI ingestion pipeline.
 *
 * @param counties       Defaults to all three South FL counties.
 * @param dateMin        ISO date, defaults to last business day.
 * @param dateMax        ISO date, defaults to last business day.
 * @param existingRunId  Reuse an existing scraper_runs record (for resume).
 * @param config         Run-limit overrides.
 * @param resumeFrom     Checkpoint from a prior paused run.  The engine skips
 *                       segments that precede the checkpoint county+distressType,
 *                       and resumes pagination inside the checkpointed segment.
 */
export async function runREAPIIngestion(
  counties:       REAPICounty[] = ['broward', 'miami-dade', 'palm-beach'],
  dateMin?:       string,
  dateMax?:       string,
  existingRunId?: string,
  config:         IngestionRunConfig = DEFAULT_INGESTION_CONFIG,
  resumeFrom?:    IngestionCheckpoint,
): Promise<REAPIRunResult> {
  const supabase   = getSupabase()
  const startedAt  = new Date()
  const startTime  = startedAt.getTime()
  const startedISO = startedAt.toISOString()
  const targetDate = lastBusinessDayISO()
  const dMin       = dateMin ?? targetDate
  const dMax       = dateMax ?? targetDate
  const jobId      = `reapi-ingest:${counties.join(',')}:${dMin}`

  console.log(`[REAPI Engine] job_id=${jobId} | counties=${counties.join(',')} | date=${dMin}→${dMax}${resumeFrom ? ` | resuming from ${resumeFrom.county}/${resumeFrom.distress_type}@${resumeFrom.next_page_index}` : ''}`)

  const apiKey = process.env.REAPI_KEY
  if (!apiKey) throw new Error('REAPI_KEY environment variable is not set')

  // Fetch pricing once (fail-closed)
  const pricing = await pricingEngine.getActivePricing(INGESTION_FEATURE_KEY)
  if (!pricing || !pricing.is_enabled) {
    throw new Error(`Feature ${INGESTION_FEATURE_KEY} is not configured or is disabled`)
  }
  if (pricing.requires_confirmed_cost && pricing.expected_vendor_cost_cents === 0) {
    throw new Error(`Feature ${INGESTION_FEATURE_KEY} has unconfirmed vendor cost — ingestion blocked`)
  }

  // ── Create / reuse scraper_runs record ────────────────────────────────────
  let runId: string

  if (existingRunId) {
    runId = existingRunId
  } else {
    const { data: run, error: runErr } = await supabase
      .from('scraper_runs')
      .insert([{ triggered_by: 'reapi-ingestion', status: 'running', metadata: { job_id: jobId } }])
      .select()
      .single()

    if (runErr || !run) {
      throw new Error(`Failed to create scraper_runs record: ${runErr?.message}`)
    }
    runId = run.id
  }

  const runState: RunState = {
    callsAttempted:     0,
    callsCompleted:     0,
    estimatedCostCents: 0,
    actualCostCents:    0,
    recordsProcessed:   0,
    paused:             false,
    pauseReason:        undefined,
    checkpoint:         undefined,
  }

  // ── Determine which segments to process ──────────────────────────────────
  const distressTypes: DistressType[] = ['pre_foreclosure', 'foreclosure', 'auction']
  const allResults: REAPIIngestionResult[] = []

  // Checkpoint resume: skip segments before the resume county+distressType
  let resuming = !!resumeFrom

  for (const county of counties) {
    if (runState.paused) break

    for (const dtype of distressTypes) {
      if (runState.paused) break

      // Skip segments that precede the checkpoint
      if (resuming && resumeFrom) {
        if (county !== resumeFrom.county || dtype !== resumeFrom.distress_type) {
          // Same county but earlier distress type — skip
          if (county === resumeFrom.county && distressTypes.indexOf(dtype) < distressTypes.indexOf(resumeFrom.distress_type)) {
            continue
          }
          // Earlier county entirely — skip
          if (counties.indexOf(county) < counties.indexOf(resumeFrom.county)) {
            continue
          }
        } else {
          // This IS the checkpoint segment — clear the resuming flag so subsequent
          // segments start from page 1, and startPage below resolves correctly.
          resuming = false
        }
      }

      // Resume from saved page index within the checkpoint segment; otherwise page 1.
      const startPage = (!resuming && resumeFrom?.county === county && resumeFrom?.distress_type === dtype)
        ? resumeFrom.next_page_index : 1

      try {
        const segResult = await ingestSegment(
          supabase, apiKey, county, dtype, dMin, dMax, runId,
          startPage, config, runState, startTime, pricing,
        )
        allResults.push(segResult)
      } catch (err) {
        console.error(`[REAPI Engine] ${county}/${dtype} segment threw:`, err)
        allResults.push({
          county, distress_type: dtype,
          fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 1,
          calls_attempted: 0, calls_completed: 0,
          estimated_cost_cents: 0, actual_cost_cents: 0,
          source: 'error',
        })
      }
    }
  }

  const completedAt = new Date()
  const durationMs  = completedAt.getTime() - startedAt.getTime()

  const totIns  = allResults.reduce((s, r) => s + r.inserted, 0)
  const totUpd  = allResults.reduce((s, r) => s + r.updated,  0)
  const totSkip = allResults.reduce((s, r) => s + r.skipped,  0)
  const totErr  = allResults.reduce((s, r) => s + r.errors,   0)

  // ── Persist run result + checkpoint ──────────────────────────────────────
  const metadata: Record<string, unknown> = {
    job_id:               jobId,
    calls_attempted:      runState.callsAttempted,
    calls_completed:      runState.callsCompleted,
    estimated_cost_cents: runState.estimatedCostCents,
    actual_cost_cents:    runState.actualCostCents,
    records_processed:    runState.recordsProcessed,
    paused:               runState.paused,
    pause_reason:         runState.pauseReason ?? null,
    checkpoint:           runState.checkpoint ?? null,
  }

  await supabase.from('scraper_runs').update({
    status:           runState.paused ? 'paused' : (totErr > 0 && totIns + totUpd === 0 ? 'error' : 'success'),
    completed_at:     completedAt.toISOString(),
    broward_count:    allResults.filter(r => r.county === 'broward').reduce((s, r) => s + r.inserted, 0),
    miami_dade_count: allResults.filter(r => r.county === 'miami-dade').reduce((s, r) => s + r.inserted, 0),
    pbc_count:        allResults.filter(r => r.county === 'palm-beach').reduce((s, r) => s + r.inserted, 0),
    total_records:    totIns + totUpd,
    duration_ms:      durationMs,
    metadata,
  }).eq('id', runId)

  const runResult: REAPIRunResult = {
    run_id:               runId,
    job_id:               jobId,
    started_at:           startedISO,
    completed_at:         completedAt.toISOString(),
    duration_ms:          durationMs,
    total_inserted:       totIns,
    total_updated:        totUpd,
    total_skipped:        totSkip,
    total_errors:         totErr,
    calls_attempted:      runState.callsAttempted,
    calls_completed:      runState.callsCompleted,
    estimated_cost_cents: runState.estimatedCostCents,
    actual_cost_cents:    runState.actualCostCents,
    records_processed:    runState.recordsProcessed,
    paused:               runState.paused,
    pause_reason:         runState.pauseReason,
    checkpoint:           runState.checkpoint,
    counties:             allResults,
  }

  const statusLine = runState.paused
    ? `PAUSED(${runState.pauseReason}) @${runState.checkpoint?.county}/${runState.checkpoint?.distress_type} page ${runState.checkpoint?.next_page_index}`
    : `DONE — ${totIns} inserted, ${totUpd} updated, ${totErr} errors`

  console.log(
    `[REAPI Engine] job_id=${jobId} run_id=${runId} | ` +
    `calls=${runState.callsAttempted}/${runState.callsCompleted} ` +
    `cost=${runState.estimatedCostCents}¢est/${runState.actualCostCents}¢actual ` +
    `records=${runState.recordsProcessed} (${durationMs}ms) | ${statusLine}`
  )

  return runResult
}

// Keep resumeStartPage in scope — used in the loop above but extracted by TS
void (resumeStartPage => resumeStartPage)(1)
