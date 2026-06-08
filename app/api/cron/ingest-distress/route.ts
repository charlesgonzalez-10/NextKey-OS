/**
 * Vercel Cron Job — Daily OR Ingestion Pipeline
 *
 * Runs Monday–Friday at 8 AM ET (13:00 UTC).
 * Schedule is defined in vercel.json:
 *   { "path": "/api/cron/ingest-distress", "schedule": "0 13 * * 1-5" }
 *
 * Security: requests must carry `Authorization: Bearer <CRON_SECRET>`.
 * Vercel Cron injects this automatically when CRON_SECRET is set in env.
 * For manual / dev triggers, pass the header yourself.
 *
 * Supports an optional ?counties= query param to run a subset of counties:
 *   /api/cron/ingest-distress?counties=broward,miami-dade
 *
 * Response shape on success (HTTP 200):
 * {
 *   "success": true,
 *   "run_id": "...",
 *   "duration_ms": 12345,
 *   "total_inserted": 43,
 *   "total_skipped":  12,
 *   "total_errors":    1,
 *   "counties": [
 *     { "county": "broward",    "fetched": 820, "filtered": 20, "inserted": 18, "skipped": 2, "errors": 0 },
 *     { "county": "miami-dade", "fetched": 510, "filtered": 15, "inserted": 12, "skipped": 3, "errors": 0 },
 *     { "county": "palm-beach", "fetched": 380, "filtered": 10, "inserted": 9,  "skipped": 1, "errors": 1 }
 *   ]
 * }
 */

import { NextResponse } from 'next/server'
import { runIngestionPipeline } from '@/lib/ingestion/engine'
import type { County } from '@/lib/scrapers/types'

// Vercel Functions config — OR ingestion can be slow on heavy days
export const dynamic    = 'force-dynamic'
export const maxDuration = 300   // 5 minutes (Pro plan max)

const ALL_COUNTIES: County[] = ['broward', 'miami-dade', 'palm-beach']

export async function GET(request: Request) {
  // ── Auth guard ──────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET) {
    console.error('[Cron: ingest-distress] CRON_SECRET env var is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── County selection ────────────────────────────────────────────────────────
  const url      = new URL(request.url)
  const rawParam = url.searchParams.get('counties')
  const counties: County[] = rawParam
    ? (rawParam.split(',').map(s => s.trim()).filter(c => ALL_COUNTIES.includes(c as County)) as County[])
    : ALL_COUNTIES

  if (counties.length === 0) {
    return NextResponse.json(
      { error: `No valid counties. Must be one of: ${ALL_COUNTIES.join(', ')}` },
      { status: 400 }
    )
  }

  // ── Run pipeline ────────────────────────────────────────────────────────────
  console.log(`[Cron: ingest-distress] Starting OR ingestion for counties: ${counties.join(', ')}`)

  try {
    const result = await runIngestionPipeline(counties)

    // Strip the verbose per-record outcome arrays from the HTTP response to keep
    // it readable — they're already persisted in scraper_runs.error_log / skip_log.
    const summary = {
      success:         true,
      run_id:          result.run_id,
      started_at:      result.started_at,
      completed_at:    result.completed_at,
      duration_ms:     result.duration_ms,
      total_inserted:  result.total_inserted,
      total_skipped:   result.total_skipped,
      total_errors:    result.total_errors,
      counties: result.counties.map(c => ({
        county:   c.county,
        source:   c.adapter_source,
        fetched:  c.fetched,
        filtered: c.filtered,
        inserted: c.inserted,
        skipped:  c.skipped,
        errors:   c.errors,
      })),
    }

    console.log(`[Cron: ingest-distress] Complete — run_id: ${result.run_id} (${result.duration_ms}ms)`)
    return NextResponse.json(summary)

  } catch (err) {
    // runIngestionPipeline is designed not to throw, but catch anyway
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Cron: ingest-distress] Unhandled error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * POST handler — allows manual triggers from the NextKey OS admin UI
 * or from CI without needing GET semantics.
 * Body (optional JSON): { "counties": ["broward", "miami-dade"] }
 */
export async function POST(request: Request) {
  // Same auth check
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let counties: County[] = ALL_COUNTIES
  try {
    const body = await request.json().catch(() => ({}))
    if (Array.isArray(body?.counties) && body.counties.length > 0) {
      const filtered = body.counties.filter((c: string) => ALL_COUNTIES.includes(c as County)) as County[]
      if (filtered.length > 0) counties = filtered
    }
  } catch { /* body is optional — use all counties */ }

  // Delegate to the GET logic by forwarding to the same handler
  const getRequest = new Request(request.url, {
    method:  'GET',
    headers: request.headers,
  })
  return GET(getRequest)
}
