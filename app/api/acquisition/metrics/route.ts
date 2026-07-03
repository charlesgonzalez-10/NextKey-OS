/**
 * GET /api/acquisition/metrics
 *
 * Returns acquisition pipeline metrics for the dashboard widget:
 * - leads_by_pipeline: count per acquisition_pipeline slug
 * - surplus_status_breakdown: count per surplus_status
 * - calls_today: call log entries created today
 * - follow_ups_due: leads with follow_up_at <= now
 * - total_surplus_value: sum of surplus_funds_amount for surplus-funds leads
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date().toISOString()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [pipelinesRes, surplusStatusRes, callsTodayRes, followUpsRes, surplusValueRes] = await Promise.all([
    // Leads by acquisition pipeline
    serviceClient
      .from('leads')
      .select('acquisition_pipeline')
      .not('acquisition_pipeline', 'is', null),

    // Surplus status breakdown
    serviceClient
      .from('leads')
      .select('surplus_status')
      .eq('acquisition_pipeline', 'surplus-funds')
      .not('surplus_status', 'is', null),

    // Calls logged today
    serviceClient
      .from('call_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString()),

    // Follow-ups due (at or past due)
    serviceClient
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .lte('follow_up_at', now)
      .not('follow_up_at', 'is', null),

    // Total surplus value
    serviceClient
      .from('properties')
      .select('surplus_funds_amount')
      .not('surplus_funds_amount', 'is', null)
      .gt('surplus_funds_amount', 0),
  ])

  // Aggregate pipeline counts
  const pipelineCounts: Record<string, number> = {}
  for (const row of pipelinesRes.data ?? []) {
    const slug = row.acquisition_pipeline as string
    pipelineCounts[slug] = (pipelineCounts[slug] ?? 0) + 1
  }

  // Aggregate surplus status counts
  const surplusStatusCounts: Record<string, number> = {}
  for (const row of surplusStatusRes.data ?? []) {
    const s = row.surplus_status as string
    surplusStatusCounts[s] = (surplusStatusCounts[s] ?? 0) + 1
  }

  // Total surplus value
  const totalSurplusValue = (surplusValueRes.data ?? []).reduce(
    (sum, r) => sum + ((r.surplus_funds_amount as number) ?? 0), 0
  )

  return NextResponse.json({
    leads_by_pipeline:       pipelineCounts,
    surplus_status_breakdown: surplusStatusCounts,
    calls_today:             callsTodayRes.count ?? 0,
    follow_ups_due:          followUpsRes.count  ?? 0,
    total_surplus_value:     totalSurplusValue,
  })
}
