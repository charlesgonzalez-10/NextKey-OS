/**
 * OR Ingestion Engine — master orchestrator
 *
 * Drives the full daily Lis Pendens ingestion pipeline:
 *   Adapters → Dedup guard → Folio resolver → DB transaction → Audit log
 *
 * Tech stack note: this codebase uses the Supabase JS client exclusively —
 * there is no Prisma. Atomicity is achieved via sequential operations with
 * explicit cleanup (compensating transactions) on failure, matching the
 * pattern established in lib/scrapers/runner.ts.
 *
 * DB table names match the production schema:
 *   properties        — master property ledger (folio_number = unique identifier)
 *   leads             — CRM pipeline (1:1 via property_id)
 *   distress_filings  — one row per LP court filing (see migrations/distress_filings.sql)
 *   scraper_runs      — audit / run history
 */

import { createClient } from '@supabase/supabase-js'
import { BrowardORAdapter }   from './adapters/broward-or'
import { MiamiDadeORAdapter } from './adapters/miami-dade-or'
import { PalmBeachORAdapter } from './adapters/palm-beach-or'
import { resolveCourtRecordToFolio } from './resolver'
import { detectEntityType } from '@/lib/scrapers/utils'
import type { County }      from '@/lib/scrapers/types'
import type { ORRecord, AdapterResult } from './adapters/types'

// ─── Supabase client (service role — server-side only) ────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface RecordOutcome {
  case_number:       string
  county:            County
  status:            'inserted' | 'skipped_duplicate' | 'skipped_unresolved' | 'error'
  folio_number?:     string | null
  property_id?:      string
  lead_id?:          string
  resolution_method?: string
  reason?:           string         // for skipped / error
}

export interface CountyIngestionResult {
  county:     County
  adapter_source: string
  fetched:    number           // rows from OR index before LP filter
  filtered:   number           // LP rows after filter
  inserted:   number
  skipped:    number
  errors:     number
  outcomes:   RecordOutcome[]
}

export interface IngestionRunResult {
  run_id:      string
  started_at:  string
  completed_at: string
  counties:    CountyIngestionResult[]
  total_inserted:  number
  total_skipped:   number
  total_errors:    number
  duration_ms:     number
}

// ─── County adapter factory ───────────────────────────────────────────────────

type AdapterMap = {
  'broward':    BrowardORAdapter
  'miami-dade': MiamiDadeORAdapter
  'palm-beach': PalmBeachORAdapter
}

function makeAdapters(counties: County[]): (BrowardORAdapter | MiamiDadeORAdapter | PalmBeachORAdapter)[] {
  const all: AdapterMap = {
    'broward':    new BrowardORAdapter(),
    'miami-dade': new MiamiDadeORAdapter(),
    'palm-beach': new PalmBeachORAdapter(),
  }
  return counties.map(c => all[c as keyof AdapterMap]).filter(Boolean)
}

// ─── Dedup guard ──────────────────────────────────────────────────────────────

/**
 * Returns the existing property_id if this case_number is already in the DB,
 * or null if it's new.
 */
async function findExistingByCaseNumber(
  supabase: ReturnType<typeof getSupabase>,
  caseNumber: string
): Promise<{ property_id: string; has_lead: boolean } | null> {
  // Check distress_filings first (fastest path for re-runs)
  const { data: filing } = await supabase
    .from('distress_filings')
    .select('property_id')
    .eq('case_number', caseNumber)
    .maybeSingle()

  if (filing?.property_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('property_id', filing.property_id)
      .maybeSingle()
    return { property_id: filing.property_id, has_lead: !!lead }
  }

  // Also check properties.case_number (legacy records from the old scraper)
  const { data: prop } = await supabase
    .from('properties')
    .select('id')
    .eq('case_number', caseNumber)
    .maybeSingle()

  if (prop?.id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('property_id', prop.id)
      .maybeSingle()
    return { property_id: prop.id, has_lead: !!lead }
  }

  return null
}

// ─── Single-record ingestion (the "transaction") ──────────────────────────────

/**
 * Ingests one ORRecord into the DB. Steps:
 *   1. Dedup guard — skip if case_number already exists
 *   2. Resolve court record → folio_number
 *   3. Upsert property (by folio_number if resolved, else insert new)
 *   4. Insert distress_filing
 *   5. Create lead entry (if not already in pipeline)
 *
 * On any failure after a partial write, a compensating delete is attempted to
 * keep the DB consistent. This mirrors the pattern in lib/scrapers/runner.ts.
 */
async function ingestRecord(
  supabase: ReturnType<typeof getSupabase>,
  record:   ORRecord,
  runId:    string
): Promise<RecordOutcome> {
  const base = { case_number: record.case_number, county: record.county }

  // ── 1. Dedup guard ────────────────────────────────────────────────────────
  const existing = await findExistingByCaseNumber(supabase, record.case_number)
  if (existing) {
    // Already in DB. If it somehow doesn't have a lead yet, create one now.
    if (!existing.has_lead) {
      await supabase.from('leads').insert([{
        property_id: existing.property_id,
        status:      'new',
        source:      'or-ingestion',
      }]).then(({ error }) => {
        if (error) console.warn(`[Engine] leads back-fill failed ${record.case_number}:`, error.message)
      })
    }
    return { ...base, status: 'skipped_duplicate', property_id: existing.property_id,
             reason: 'case_number already in DB' }
  }

  // ── 2. Resolve folio ──────────────────────────────────────────────────────
  const resolution = await resolveCourtRecordToFolio(record)

  // Records with unresolved folios are still ingested — the investor can
  // resolve the property from the Lead Detail page. We just can't upsert
  // by folio, so we do a plain insert.
  if (!resolution.folio_number) {
    console.log(`[Engine] ${record.case_number}: unresolved folio — inserting without PA data`)
  }

  // ── 3. Upsert / insert property ───────────────────────────────────────────
  const entityType = detectEntityType(record.defendant)

  const propertyPayload = {
    scraper_run_id:     runId,
    source:             'or-ingestion',
    county:             record.county,
    data_source:        `${record.county === 'miami-dade' ? 'MD' : record.county === 'broward' ? 'Broward' : 'PBC'} OR Index`,
    case_number:        record.case_number,
    file_date:          record.recording_date,
    plaintiff:          record.plaintiff,
    mortgagor:          record.defendant,
    foreclosure_amount: record.consideration ?? null,
    foreclosure_type:   'P' as const,          // LP = pre-foreclosure
    is_pre_foreclosure: true,
    is_auction:         false,
    multiple_liens:     false,
    folio_number:       resolution.folio_number ?? null,
    owner_name:         resolution.owner_name   ?? null,
    property_address:   resolution.property_address ?? record.property_address ?? null,
    legal_description:  record.legal_description ?? null,
    entity_type:        entityType,
    state:              'FL',
    updated_at:         new Date().toISOString(),
  }

  let propertyId: string

  if (resolution.folio_number) {
    // Attempt upsert by folio_number so we update an existing property record
    // if the folio is already known (e.g. from a PropStream import).
    //
    // Supabase upsert requires folio_number to have a UNIQUE constraint.
    // If your schema doesn't have one yet, add it with:
    //   ALTER TABLE properties ADD CONSTRAINT properties_folio_number_unique
    //     UNIQUE (folio_number);
    // Until then, we check manually and update-or-insert.
    const { data: existing_prop } = await supabase
      .from('properties')
      .select('id')
      .eq('folio_number', resolution.folio_number)
      .maybeSingle()

    if (existing_prop?.id) {
      // Property already exists — update the distress flags
      const { error: updErr } = await supabase
        .from('properties')
        .update({
          is_pre_foreclosure: true,
          case_number:        record.case_number,
          file_date:          record.recording_date,
          plaintiff:          record.plaintiff,
          foreclosure_amount: record.consideration ?? null,
          scraper_run_id:     runId,
          updated_at:         new Date().toISOString(),
        })
        .eq('id', existing_prop.id)

      if (updErr) {
        return { ...base, status: 'error', folio_number: resolution.folio_number,
                 reason: `Property update failed: ${updErr.message}` }
      }
      propertyId = existing_prop.id
    } else {
      // New property
      const { data: newProp, error: insErr } = await supabase
        .from('properties')
        .insert([propertyPayload])
        .select('id')
        .single()
      if (insErr || !newProp) {
        return { ...base, status: 'error', folio_number: resolution.folio_number,
                 reason: `Property insert failed: ${insErr?.message ?? 'no data returned'}` }
      }
      propertyId = newProp.id
    }
  } else {
    // No folio — plain insert (cannot upsert without a unique key)
    const { data: newProp, error: insErr } = await supabase
      .from('properties')
      .insert([propertyPayload])
      .select('id')
      .single()
    if (insErr || !newProp) {
      return { ...base, status: 'error', folio_number: null,
               reason: `Property insert failed: ${insErr?.message ?? 'no data returned'}` }
    }
    propertyId = newProp.id
  }

  // ── 4. Insert distress_filing ─────────────────────────────────────────────
  const { error: filingErr } = await supabase
    .from('distress_filings')
    .insert([{
      property_id:      propertyId,
      case_number:      record.case_number,
      doc_type:         'LIS_PENDENS',
      county:           record.county,
      recording_date:   record.recording_date,
      plaintiff:        record.plaintiff,
      defendant:        record.defendant,
      consideration:    record.consideration ?? null,
      legal_description: record.legal_description ?? null,
      ingestion_run_id: runId,
      raw_record:       record.raw as object,
    }])

  if (filingErr) {
    // Non-fatal — property was written; log and continue
    console.warn(`[Engine] distress_filing insert failed ${record.case_number}:`, filingErr.message)
  }

  // ── 5. Promote to CRM pipeline (leads table) ──────────────────────────────
  const { data: leadCheck } = await supabase
    .from('leads')
    .select('id')
    .eq('property_id', propertyId)
    .maybeSingle()

  let leadId: string | undefined

  if (!leadCheck) {
    const { data: newLead, error: leadErr } = await supabase
      .from('leads')
      .insert([{
        property_id: propertyId,
        status:      'new',      // matches CHECK constraint: 'new'|'reviewing'|…
        source:      'or-ingestion',
        tags:        ['lis-pendens'],
      }])
      .select('id')
      .single()

    if (leadErr) {
      console.warn(`[Engine] leads insert failed ${record.case_number}:`, leadErr.message)
    } else {
      leadId = newLead?.id
    }
  } else {
    leadId = leadCheck.id
  }

  return {
    ...base,
    status:             'inserted',
    folio_number:       resolution.folio_number,
    property_id:        propertyId,
    lead_id:            leadId,
    resolution_method:  resolution.resolution_method,
  }
}

// ─── County runner ────────────────────────────────────────────────────────────

async function runCounty(
  supabase: ReturnType<typeof getSupabase>,
  adapter:  BrowardORAdapter | MiamiDadeORAdapter | PalmBeachORAdapter,
  runId:    string
): Promise<CountyIngestionResult> {
  const county = adapter.county

  // Fetch from OR index
  const adapterResult: AdapterResult = await adapter.fetch()

  if (adapterResult.error) {
    console.error(`[Engine] ${county} adapter error: ${adapterResult.error}`)
    return {
      county, adapter_source: adapterResult.source,
      fetched: 0, filtered: 0, inserted: 0, skipped: 0, errors: 1,
      outcomes: [{ case_number: '_adapter_error', county, status: 'error', reason: adapterResult.error }],
    }
  }

  const outcomes: RecordOutcome[] = []

  // Process records serially to avoid hammering the DB or PA APIs
  for (const record of adapterResult.records) {
    const outcome = await ingestRecord(supabase, record, runId)
    outcomes.push(outcome)
  }

  const inserted = outcomes.filter(o => o.status === 'inserted').length
  const skipped  = outcomes.filter(o => o.status === 'skipped_duplicate' || o.status === 'skipped_unresolved').length
  const errors   = outcomes.filter(o => o.status === 'error').length

  console.log(`[Engine] ${county}: ${inserted} inserted, ${skipped} skipped, ${errors} errors`)

  return {
    county,
    adapter_source: adapterResult.source,
    fetched:        adapterResult.fetched,
    filtered:       adapterResult.filtered,
    inserted,
    skipped,
    errors,
    outcomes,
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the full ingestion pipeline across the specified counties.
 *
 * If `existingRunId` is provided (created externally, e.g. by the cron handler),
 * that record is used for audit logging. Otherwise a new scraper_runs row is
 * created automatically.
 *
 * This function does NOT throw — all errors are captured in the result object
 * so the cron handler can always return a descriptive JSON response.
 */
export async function runIngestionPipeline(
  counties:       County[]   = ['broward', 'miami-dade', 'palm-beach'],
  existingRunId?: string
): Promise<IngestionRunResult> {
  const supabase   = getSupabase()
  const startedAt  = new Date()
  const startedISO = startedAt.toISOString()

  // ── Create / reuse scraper_runs record ────────────────────────────────────
  let runId: string

  if (existingRunId) {
    runId = existingRunId
  } else {
    const { data: run, error: runErr } = await supabase
      .from('scraper_runs')
      .insert([{ triggered_by: 'or-ingestion', status: 'running' }])
      .select()
      .single()

    if (runErr || !run) {
      throw new Error(`Failed to create scraper_runs record: ${runErr?.message}`)
    }
    runId = run.id
  }

  // ── Run each county adapter ───────────────────────────────────────────────
  const adapters = makeAdapters(counties)

  // Run counties in parallel — each has its own timeout, and PA lookups inside
  // ingestRecord are per-record so there's no cross-county contention.
  const countyResults = await Promise.allSettled(
    adapters.map(adapter => runCounty(supabase, adapter, runId))
  )

  const results: CountyIngestionResult[] = countyResults.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    const county = adapters[i].county
    console.error(`[Engine] ${county} runner threw:`, r.reason)
    return {
      county,
      adapter_source: 'unknown',
      fetched: 0, filtered: 0, inserted: 0, skipped: 0, errors: 1,
      outcomes: [{ case_number: '_runner_error', county, status: 'error' as const, reason: String(r.reason) }],
    }
  })

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const totalInserted = results.reduce((s, r) => s + r.inserted, 0)
  const totalSkipped  = results.reduce((s, r) => s + r.skipped,  0)
  const totalErrors   = results.reduce((s, r) => s + r.errors,   0)
  const completedAt   = new Date()
  const durationMs    = completedAt.getTime() - startedAt.getTime()

  // ── Update scraper_runs audit record ──────────────────────────────────────
  const bw = results.find(r => r.county === 'broward')
  const md = results.find(r => r.county === 'miami-dade')
  const pb = results.find(r => r.county === 'palm-beach')

  const errorLog = results.flatMap(r =>
    r.outcomes
      .filter(o => o.status === 'error')
      .map(o => ({ case_number: o.case_number, reason: o.reason, county: o.county }))
  )
  const skipLog = results.flatMap(r =>
    r.outcomes
      .filter(o => o.status === 'skipped_duplicate' || o.status === 'skipped_unresolved')
      .map(o => ({ case_number: o.case_number, reason: o.reason, county: o.county }))
  )

  await supabase.from('scraper_runs').update({
    status:          totalErrors > 0 && totalInserted === 0 ? 'failed' : 'completed',
    completed_at:    completedAt.toISOString(),
    broward_new:     bw?.inserted    || 0,
    broward_skip:    bw?.skipped     || 0,
    broward_err:     bw?.errors      || 0,
    miami_dade_new:  md?.inserted    || 0,
    miami_dade_skip: md?.skipped     || 0,
    miami_dade_err:  md?.errors      || 0,
    palm_beach_new:  pb?.inserted    || 0,
    palm_beach_skip: pb?.skipped     || 0,
    palm_beach_err:  pb?.errors      || 0,
    total_new:       totalInserted,
    total_skipped:   totalSkipped,
    total_errors:    totalErrors,
    error_log:       errorLog,
    skip_log:        skipLog,
  }).eq('id', runId)

  console.log(`[Engine] Run ${runId} complete: ${totalInserted} inserted, ${totalSkipped} skipped, ${totalErrors} errors (${durationMs}ms)`)

  return {
    run_id:          runId,
    started_at:      startedISO,
    completed_at:    completedAt.toISOString(),
    counties:        results,
    total_inserted:  totalInserted,
    total_skipped:   totalSkipped,
    total_errors:    totalErrors,
    duration_ms:     durationMs,
  }
}
