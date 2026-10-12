/**
 * Deal Scrubber — run orchestration
 *
 * 1. Work out the filing-date window (picks up where the last run ended).
 * 2. Pull Broward pre-foreclosures for that window with the existing,
 *    budget-capped REAPI ingestion engine.
 * 3. Keep only new records that fit the buy box (area, type, units, value)
 *    and were never scrubbed before.
 * 4. Check each is still an active foreclosure (REAPI foreclosure history);
 *    closed ones are archived.
 * 5. Attach comps (Rentcast) and an equity estimate to the active ones.
 * 6. Store the batch in deal_scrub_runs / deal_scrub_items.
 *
 * Judgment calls (photos, condition, who to call) are made afterwards by the
 * Agent HQ Deal Scrubber agent, which reads the batch through
 * GET /api/scrubber/batch.
 */

import { serviceClient } from '@/lib/supabase-service'
import { runREAPIIngestion, DEFAULT_INGESTION_CONFIG } from '@/lib/ingestion/reapi-engine'
import { lookupCaseNumber, type ForeclosureInfoEntry } from '@/lib/ingestion/reapi-case-lookup'
import { fetchCompsRentcast, rentcastConfigured } from '@/lib/mls/rentcast'
import {
  DEFAULT_SCRUB_CONFIG, type ScrubConfig, fitsBuyBox, scrubWindow,
  foreclosureStatus, estimateValue, equityFraction,
} from './config'

export interface ScrubRunSummary {
  run_id:        string
  window_from:   string
  window_to:     string
  pulled:        number
  in_buy_box:    number
  already_seen:  number
  active:        number
  closed:        number
  unknown:       number
  pull_cost_cents: number
  paused:        boolean
  pause_reason?: string
}

type Row = Record<string, unknown>
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export async function runDealScrub(opts: { now?: Date; config?: Partial<ScrubConfig> } = {}): Promise<ScrubRunSummary> {
  const cfg: ScrubConfig = { ...DEFAULT_SCRUB_CONFIG, ...(opts.config ?? {}) }
  const db = serviceClient
  const now = opts.now ?? new Date()

  // ── 1. Window ────────────────────────────────────────────────────────────
  const { data: last } = await db
    .from('deal_scrub_runs')
    .select('window_to')
    .eq('status', 'completed')
    .order('window_to', { ascending: false })
    .limit(1)
    .maybeSingle()
  const win = scrubWindow((last?.window_to as string | undefined) ?? null, now, cfg)

  const { data: runRow, error: runErr } = await db
    .from('deal_scrub_runs')
    .insert({ window_from: win.from, window_to: win.to, status: 'running', filters: cfg })
    .select('id')
    .single()
  if (runErr || !runRow) throw new Error(`Could not create scrub run: ${runErr?.message ?? 'unknown'}`)
  const runId = runRow.id as string

  const summary: ScrubRunSummary = {
    run_id: runId, window_from: win.from, window_to: win.to,
    pulled: 0, in_buy_box: 0, already_seen: 0, active: 0, closed: 0, unknown: 0,
    pull_cost_cents: 0, paused: false,
  }

  try {
    // ── 2. Pull ────────────────────────────────────────────────────────────
    const ingest = await runREAPIIngestion([cfg.county], win.from, win.to, undefined, {
      ...DEFAULT_INGESTION_CONFIG,
      maxVendorCostCents: cfg.maxPullCents,
    })
    summary.pull_cost_cents = ingest.actual_cost_cents ?? ingest.estimated_cost_cents ?? 0
    if (ingest.paused) { summary.paused = true; summary.pause_reason = ingest.pause_reason }

    // ── 3. Candidates from this pull ────────────────────────────────────────
    const { data: pulled } = await db
      .from('properties')
      .select('id, folio_number, property_address, city, zip, owner_name, market_value, known_debt, property_type, is_pre_foreclosure, living_area, beds, baths, year_built, lender_name, file_date, raw_reapi')
      .eq('scraper_run_id', ingest.run_id)
    const rows = (pulled ?? []) as Row[]
    summary.pulled = rows.length

    const fits = rows.filter(r => {
      const raw = (r.raw_reapi ?? {}) as Row
      return fitsBuyBox({
        city: str(r.city), property_type: str(r.property_type),
        units: num(raw.unitsCount), market_value: num(r.market_value),
        is_pre_foreclosure: r.is_pre_foreclosure === true,
      }, cfg).keep
    })
    summary.in_buy_box = fits.length

    const folios = fits.map(r => str(r.folio_number)).filter((f): f is string => !!f)
    const { data: seen } = folios.length
      ? await db.from('deal_scrub_items').select('folio_number').in('folio_number', folios)
      : { data: [] as Row[] }
    const seenSet = new Set((seen ?? []).map(s => s.folio_number as string))
    const fresh = fits.filter(r => !seenSet.has(str(r.folio_number) ?? ''))
    summary.already_seen = fits.length - fresh.length

    // ── 4–5. Active check, comps, equity ────────────────────────────────────
    let compsCalls = 0
    for (const r of fresh.slice(0, cfg.maxCandidates)) {
      const folio = str(r.folio_number)
      if (!folio) continue
      const raw = (r.raw_reapi ?? {}) as Row

      const lookup = await lookupCaseNumber({ apn: folio, county: cfg.county })
      const history: ForeclosureInfoEntry[] =
        lookup.outcome === 'found' || lookup.outcome === 'not_found' ? lookup.foreclosure_history : []
      const status = foreclosureStatus(history)
      summary[status] += 1
      const latest = [...history].sort((a, b) =>
        String(b.recordingDate ?? '').localeCompare(String(a.recordingDate ?? '')))[0]

      let comps: unknown = null, value = null as number | null, basis = 'none'
      if (status !== 'closed' && rentcastConfigured() && compsCalls < cfg.maxCompsCalls && str(r.property_address)) {
        compsCalls += 1
        try {
          const c = await fetchCompsRentcast(String(r.property_address), { radiusMi: 0.5, monthsBack: 12 })
          const sold = c.sold ?? []
          const est = estimateValue({
            soldPricesPerSqft: sold.map(s => s.price_per_sqft ?? 0),
            livingArea: num(r.living_area), avm: c.avm_estimate ?? null, reapiValue: num(r.market_value),
          })
          value = est.value; basis = est.basis
          comps = { source: c.source, median_sold_price: c.median_sold_price, avg_price_per_sqft: c.avg_price_per_sqft,
            sold: sold.slice(0, 8).map(s => ({ address: s.address, sold_price: s.sold_price, sold_date: s.sold_date,
              living_area: s.living_area, beds: s.beds, baths: s.baths, price_per_sqft: s.price_per_sqft, distance_miles: s.distance_miles })) }
        } catch (e) {
          comps = { error: e instanceof Error ? e.message : 'comps_failed' }
        }
      }
      if (value == null) { const est = estimateValue({ soldPricesPerSqft: [], livingArea: null, avm: null, reapiValue: num(r.market_value) }); value = est.value; basis = est.basis }
      const debt = num(r.known_debt)

      await db.from('deal_scrub_items').insert({
        run_id:          runId,
        property_id:     r.id,
        folio_number:    folio,
        address:         str(r.property_address),
        city:            str(r.city),
        zip:             str(r.zip),
        owner_name:      str(r.owner_name),
        mail_address:    raw.mailAddress ?? null,
        property_type:   str(r.property_type),
        units:           num(raw.unitsCount),
        beds:            num(r.beds), baths: num(r.baths),
        living_area:     num(r.living_area), year_built: num(r.year_built),
        foreclosure_status: status,
        case_number:     latest?.caseNumber ?? null,
        lender_name:     latest?.lenderName ?? str(r.lender_name),
        recording_date:  latest?.recordingDate ?? null,
        default_amount:  latest?.defaultAmount ?? null,
        judgment_amount: latest?.judgmentAmount ?? null,
        document_type:   latest?.documentType ?? null,
        foreclosure_history: history,
        open_mortgage_balance: debt,
        estimated_value: value,
        value_basis:     basis,
        equity_fraction: equityFraction(value, debt),
        comps,
        status:          status === 'closed' ? 'archived_closed' : 'ready_for_review',
      })
    }

    await db.from('deal_scrub_runs').update({
      // A paused (budget-capped) pull is 'partial' so the next run re-pulls the same window;
      // already-scrubbed folios are skipped, so nothing is processed twice.
      status: summary.paused ? 'partial' : 'completed', finished_at: new Date().toISOString(), summary,
    }).eq('id', runId)
    return summary
  } catch (e) {
    await db.from('deal_scrub_runs').update({
      status: 'failed', finished_at: new Date().toISOString(),
      summary: { ...summary, error: e instanceof Error ? e.message : String(e) },
    }).eq('id', runId)
    throw e
  }
}
