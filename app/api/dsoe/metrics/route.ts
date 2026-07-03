/**
 * GET /api/dsoe/metrics
 * Returns aggregated Data Source Optimization Engine statistics.
 * Used by the DataSourceMetrics dashboard widget.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDSOEMetrics } from '@/lib/dsoe'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const metrics = await getDSOEMetrics()
  return NextResponse.json(metrics)
}
