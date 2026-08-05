/**
 * Vercel Cron Job — Daily REAPI Distress Property Ingestion
 *
 * Runs Monday–Friday at 8 AM ET (13:00 UTC).
 * Schedule defined in vercel.json:
 *   { "path": "/api/cron/ingest-distress", "schedule": "0 13 * * 1-5" }
 *
 * Uses REAPI /v2/PropertySearch to pull daily pre-foreclosure, foreclosure,
 * and auction records for Broward, Miami-Dade, and Palm Beach counties.
 *
 * Security: requests must carry `Authorization: Bearer <CRON_SECRET>`.
 *
 * Supports optional query params:
 *   ?counties=broward,miami-dade     — subset of counties
 *   ?date_min=2026-06-01             — override start date (default: last business day)
 *   ?date_max=2026-06-06             — override end date   (default: last business day)
 *
 * Response shape:
 * {
 *   "success": true,
 *   "run_id": "...",
 *   "duration_ms": 12345,
 *   "total_inserted": 43,
 *   "total_updated":  5,
 *   "total_skipped":  0,
 *   "total_errors":   0,
 *   "counties": [
 *     { "county": "broward",    "fetched": 24, "inserted": 20, "updated": 4, ... },
 *     { "county": "miami-dade", "fetched": 18, "inserted": 15, "updated": 3, ... },
 *     { "county": "palm-beach", "fetched": 12, "inserted": 10, "updated": 2, ... }
 *   ]
 * }
 */

import { NextResponse } from 'next/server'
import { runREAPIIngestion } from '@/lib/ingestion/reapi-engine'
import type { REAPICounty } from '@/lib/ingestion/reapi-engine'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300   // 5 minutes (Vercel Pro max)

const ALL_COUNTIES: REAPICounty[] = ['broward', 'miami-dade', 'palm-beach']

export async function GET(request: Request) {
  // ── Auth guard ────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET) {
    console.error('[Cron: ingest-distress] CRON_SECRET env var is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (process.env.CRON_INGEST_DISTRESS_ENABLED === 'false') {
    console.log('[Cron: ingest-distress] Skipped — CRON_INGEST_DISTRESS_ENABLED=false')
    return NextResponse.json({ status: 'paused', reason: 'cron_disabled' })
  }

  // ── Parse params ──────────────────────────────────────────────────────────
  const url      = new URL(request.url)
  const rawParam = url.searchParams.get('counties')
  const dateMin  = url.searchParams.get('date_min') ?? undefined
  const dateMax  = url.searchParams.get('date_max') ?? undefined

  const counties: REAPICounty[] = rawParam
    ? (rawParam.split(',').map(s => s.trim()).filter(c => ALL_COUNTIES.includes(c as REAPICounty)) as REAPICounty[])
    : ALL_COUNTIES

  if (counties.length === 0) {
    return NextResponse.json(
      { error: `No valid counties. Must be one of: ${ALL_COUNTIES.join(', ')}` },
      { status: 400 }
    )
  }

  console.log(`[Cron: ingest-distress] Starting REAPI ingestion for counties: ${counties.join(', ')}`)

  try {
    const result = await runREAPIIngestion(counties, dateMin, dateMax)

    const summary = {
      success:              !result.paused,
      paused:               result.paused,
      pause_reason:         result.pause_reason ?? null,
      checkpoint:           result.checkpoint   ?? null,
      run_id:               result.run_id,
      started_at:           result.started_at,
      completed_at:         result.completed_at,
      duration_ms:          result.duration_ms,
      total_inserted:       result.total_inserted,
      total_updated:        result.total_updated,
      total_skipped:        result.total_skipped,
      total_errors:         result.total_errors,
      calls_attempted:      result.calls_attempted,
      calls_completed:      result.calls_completed,
      estimated_cost_cents: result.estimated_cost_cents,
      actual_cost_cents:    result.actual_cost_cents,
      records_processed:    result.records_processed,
      counties: result.counties.map(c => ({
        county:               c.county,
        distress_type:        c.distress_type,
        source:               c.source,
        fetched:              c.fetched,
        inserted:             c.inserted,
        updated:              c.updated,
        skipped:              c.skipped,
        errors:               c.errors,
        calls_attempted:      c.calls_attempted,
        calls_completed:      c.calls_completed,
        estimated_cost_cents: c.estimated_cost_cents,
        actual_cost_cents:    c.actual_cost_cents,
      })),
    }

    console.log(`[Cron: ingest-distress] Complete — run_id: ${result.run_id} (${result.duration_ms}ms)`)
    return NextResponse.json(summary)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Cron: ingest-distress] Unhandled error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * POST — allows manual triggers from the NextKey OS UI or CI.
 * Body (optional JSON): { "counties": ["broward"], "date_min": "2026-06-01", "date_max": "2026-06-06" }
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))

    let counties: REAPICounty[] = ALL_COUNTIES
    if (Array.isArray(body?.counties) && body.counties.length > 0) {
      const valid = body.counties.filter((c: string) => ALL_COUNTIES.includes(c as REAPICounty)) as REAPICounty[]
      if (valid.length > 0) counties = valid
    }

    const dateMin: string | undefined = body?.date_min ?? undefined
    const dateMax: string | undefined = body?.date_max ?? undefined

    // Forward to GET handler logic
    const url = new URL(request.url)
    url.searchParams.set('counties', counties.join(','))
    if (dateMin) url.searchParams.set('date_min', dateMin)
    if (dateMax) url.searchParams.set('date_max', dateMax)

    return GET(new Request(url.toString(), { headers: request.headers }))
  } catch { /* fall through */ }

  return GET(new Request(request.url, { headers: request.headers }))
}
