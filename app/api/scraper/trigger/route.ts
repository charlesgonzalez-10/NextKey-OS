/**
 * Manual scraper trigger — called from /scraper admin page
 *
 * Fire-and-forget: creates the run record, returns the run_id immediately,
 * then the actual scraping runs via after() so the browser isn't blocked.
 */

import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { runScraper } from '@/lib/scrapers/runner'
import type { County } from '@/lib/scrapers/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const counties: County[] = body.counties || ['miami-dade', 'broward', 'palm-beach']

  // Schedule the actual scraper to run after the response is sent.
  // The browser gets the run_id instantly; the UI polls /api/scraper/status.
  after(async () => {
    try {
      await runScraper('manual', counties)
    } catch (err) {
      console.error('Background scraper error:', err)
    }
  })

  return NextResponse.json({ success: true, started: true, counties })
}
