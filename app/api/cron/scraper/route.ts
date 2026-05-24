/**
 * Vercel Cron Job — runs every Sunday at 6am ET
 * Schedule is defined in vercel.json
 */

import { NextResponse } from 'next/server'
import { runScraper } from '@/lib/scrapers/runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5 minutes (Pro plan)

export async function GET(request: Request) {
  // Verify this is coming from Vercel Cron
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only run on Sundays (belt + suspenders in case cron schedule drifts)
  const dayOfWeek = new Date().getDay()
  if (dayOfWeek !== 0) {
    return NextResponse.json({
      skipped: true,
      reason: `Not Sunday (day ${dayOfWeek})`,
    })
  }

  try {
    console.log('Cron: starting Sunday county records scraper...')
    const runId = await runScraper('cron')
    return NextResponse.json({ success: true, run_id: runId })
  } catch (err) {
    console.error('Cron scraper error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
