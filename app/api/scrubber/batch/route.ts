/**
 * Deal Scrubber — read-only batch endpoint for the Agent HQ agent.
 *
 * GET /api/scrubber/batch            → latest finished run and its items
 * GET /api/scrubber/batch?run_id=…   → a specific run
 *
 * Auth: `Authorization: Bearer <SCRUBBER_AGENT_KEY>`. This key can only read
 * scrub results; it cannot trigger runs, spend credits or change data.
 */
import { NextResponse } from 'next/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const key = process.env.SCRUBBER_AGENT_KEY
  if (!key) return NextResponse.json({ error: 'Scrubber access is not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${key}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = new URL(request.url).searchParams.get('run_id')
  const runQ = serviceClient.from('deal_scrub_runs')
    .select('id, started_at, finished_at, window_from, window_to, status, summary')
  const { data: run, error } = runId
    ? await runQ.eq('id', runId).maybeSingle()
    : await runQ.in('status', ['completed', 'partial']).order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!run) return NextResponse.json({ run: null, items: [] })

  const { data: items, error: itemsErr } = await serviceClient
    .from('deal_scrub_items')
    .select('*')
    .eq('run_id', run.id)
    .order('equity_fraction', { ascending: false, nullsFirst: false })
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  return NextResponse.json({ run, items: items ?? [] })
}
