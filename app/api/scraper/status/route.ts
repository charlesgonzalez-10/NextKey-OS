import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Last 10 runs
  const { data: runs } = await supabase
    .from('scraper_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)

  // Lead counts this week / this month
  const weekAgo  = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30)

  const { count: weekCount } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', weekAgo.toISOString())

  const { count: monthCount } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', monthAgo.toISOString())

  // County breakdown
  const { data: countyBreakdown } = await supabase
    .from('properties')
    .select('county')
    .gte('created_at', monthAgo.toISOString())

  const countyCounts = (countyBreakdown || []).reduce(
    (acc: Record<string, number>, row: { county: string }) => {
      acc[row.county] = (acc[row.county] || 0) + 1
      return acc
    },
    {}
  )

  return NextResponse.json({
    runs: runs || [],
    stats: {
      week: weekCount || 0,
      month: monthCount || 0,
      by_county: countyCounts,
    },
  })
}
