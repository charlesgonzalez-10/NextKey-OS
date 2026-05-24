/**
 * Manual scraper trigger — called from /scraper admin page.
 *
 * Pattern: create the run record here, fire a fetch() to /api/scraper/run
 * WITHOUT awaiting it, then return the run_id immediately.
 *
 * Why not after(): after() gets killed when the trigger response is sent
 * because it shares the trigger function's time budget. The run worker
 * is a separate Lambda invocation with its own full 5-min maxDuration.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { County } from '@/lib/scrapers/types'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 30  // Trigger itself only needs a few seconds

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  // Auth check
  const { createClient: createServerClient } = await import('@/lib/supabase/server')
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const counties: County[] = body.counties || ['miami-dade', 'broward', 'palm-beach']

  // Create the run record
  const supabase = getSupabase()
  const { data: run, error: runErr } = await supabase
    .from('scraper_runs')
    .insert([{ triggered_by: 'manual', status: 'running' }])
    .select()
    .single()

  if (runErr || !run) {
    console.error('Failed to create scraper run:', runErr)
    return NextResponse.json({ error: 'Failed to create run record' }, { status: 500 })
  }

  const runId: string = run.id

  // Fire the worker Lambda — do NOT await, do NOT use after().
  // The worker is a separate function invocation with its own 5-min budget.
  const workerUrl = new URL('/api/scraper/run', request.url).toString()
  fetch(workerUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ runId, counties }),
    // No signal/timeout — the worker manages its own lifecycle
  }).catch(err => {
    console.error('[trigger] Failed to invoke run worker:', err)
  })

  // Return immediately — UI will poll /api/scraper/status for progress
  return NextResponse.json({ success: true, run_id: runId, counties })
}
