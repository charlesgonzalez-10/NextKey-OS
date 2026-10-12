/**
 * Vercel Cron — Deal Scrubber (every other Saturday)
 *
 * vercel.json fires this every Saturday; the route only runs on alternate
 * Saturdays (see isScrubSaturday). `?force=1` runs it on any day — still
 * requires CRON_SECRET, so only the owner can trigger it.
 *
 * Kill switch: set CRON_DEAL_SCRUB_ENABLED=false to pause.
 */
import { NextResponse } from 'next/server'
import { runDealScrub } from '@/lib/scrubber/run'
import { isScrubSaturday } from '@/lib/scrubber/config'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.CRON_DEAL_SCRUB_ENABLED === 'false') {
    return NextResponse.json({ status: 'paused', reason: 'cron_disabled' })
  }
  const force = new URL(request.url).searchParams.get('force') === '1'
  if (!force && !isScrubSaturday(new Date())) {
    return NextResponse.json({ status: 'skipped', reason: 'not_a_scrub_saturday' })
  }
  try {
    const summary = await runDealScrub()
    return NextResponse.json({ success: true, summary })
  } catch (e) {
    console.error('[Cron: deal-scrub] failed', e)
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}
