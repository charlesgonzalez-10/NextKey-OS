import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import LeadsClient from './leads-client'

export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const [
    { count: total },
    { count: highEquity },
    { count: thisWeek },
    { count: starred },
  ] = await Promise.all([
    supabase.from('leads').select('*', { count: 'exact', head: true }),
    supabase.from('properties').select('*', { count: 'exact', head: true }).eq('equity_tier', 'High'),
    supabase.from('properties').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('starred', true),
  ])

  return (
    <DashboardLayout>
      <LeadsClient
        initialStats={{
          total:      total      ?? 0,
          highEquity: highEquity ?? 0,
          thisWeek:   thisWeek   ?? 0,
          starred:    starred    ?? 0,
        }}
      />
    </DashboardLayout>
  )
}
