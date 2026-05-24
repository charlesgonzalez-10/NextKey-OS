/**
 * Manual scraper trigger — called from /scraper admin page
 * Runs in background, returns run ID immediately
 */

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

  try {
    const runId = await runScraper('manual', counties)
    return NextResponse.json({ success: true, run_id: runId })
  } catch (err) {
    console.error('Manual scraper trigger error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
