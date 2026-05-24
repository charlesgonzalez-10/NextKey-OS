/**
 * Scraper run worker — the actual long-running scraper Lambda.
 *
 * Invoked by /api/scraper/trigger as a fire-and-forget fetch.
 * Runs as its own independent serverless function with its own
 * maxDuration budget — not inside after(), which gets killed
 * when the trigger response is sent.
 *
 * Auth: caller passes the runId created by the trigger; this
 * endpoint verifies it exists in scraper_runs before proceeding.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runScraperFromExistingRun } from '@/lib/scrapers/runner'
import type { County } from '@/lib/scrapers/types'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 300  // 5 min — needs Vercel Pro

export async function POST(request: NextRequest) {
  let body: { runId?: string; counties?: County[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }

  const { runId, counties } = body
  if (!runId || !counties?.length) {
    return NextResponse.json({ error: 'Missing runId or counties' }, { status: 400 })
  }

  // Verify the runId is a real record in 'running' state (capability-based auth)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: run } = await supabase
    .from('scraper_runs')
    .select('id, status')
    .eq('id', runId)
    .eq('status', 'running')
    .maybeSingle()

  if (!run) {
    return NextResponse.json({ error: 'Invalid or already-completed runId' }, { status: 403 })
  }

  // Respond 202 immediately so the caller (trigger) doesn't wait
  // The actual work happens after — but since this IS the function,
  // it has its own full 5-minute maxDuration budget.
  const responsePromise = runScraperFromExistingRun(runId, counties)

  // We need to await before the Lambda exits — return a response and let
  // Node.js continue running until runScraperFromExistingRun resolves.
  // NextResponse can't be "sent early" in a Lambda context, so we await here.
  // The caller (trigger) fires this fetch without awaiting, so the browser
  // never waits on this endpoint.
  try {
    await responsePromise
    return NextResponse.json({ success: true, runId })
  } catch (err) {
    console.error('[run-worker] Scraper error:', err)
    await supabase.from('scraper_runs').update({
      status:       'failed',
      completed_at: new Date().toISOString(),
      error_log:    [{ reason: String(err) }],
    }).eq('id', runId)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
