import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import ScraperClient from './scraper-client'
import { isOwner } from '@/lib/roles'

export const dynamic = 'force-dynamic'

export default async function ScraperPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!isOwner(user.email)) redirect('/')

  // Last 10 runs
  const { data: runs } = await supabase
    .from('scraper_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)

  // Lead stats
  const weekAgo  = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30)

  const [{ count: weekCount }, { count: monthCount }, { count: totalCount }] = await Promise.all([
    supabase.from('properties').select('*', { count: 'exact', head: true })
      .gte('created_at', weekAgo.toISOString()),
    supabase.from('properties').select('*', { count: 'exact', head: true })
      .gte('created_at', monthAgo.toISOString()),
    supabase.from('properties').select('*', { count: 'exact', head: true }),
  ])

  // County breakdown (all time)
  const { data: countyData } = await supabase
    .from('properties')
    .select('county')

  const countyCounts = (countyData || []).reduce(
    (acc: Record<string, number>, row: { county: string }) => {
      acc[row.county] = (acc[row.county] || 0) + 1
      return acc
    },
    {}
  )

  // Equity tier breakdown
  const { data: equityData } = await supabase
    .from('properties')
    .select('equity_tier')
    .not('equity_tier', 'is', null)

  const equityCounts = (equityData || []).reduce(
    (acc: Record<string, number>, row: { equity_tier: string }) => {
      acc[row.equity_tier] = (acc[row.equity_tier] || 0) + 1
      return acc
    },
    {}
  )

  return (
    <DashboardLayout>
      <ScraperClient
        runs={runs ?? []}
        stats={{
          week: weekCount || 0,
          month: monthCount || 0,
          total: totalCount || 0,
          by_county: countyCounts,
          by_equity: equityCounts,
        }}
      />
    </DashboardLayout>
  )
}
