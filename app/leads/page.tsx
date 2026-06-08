import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import PropertySearchClient from './leads-client'
import type { CriteriaState } from '@/components/PropertySearchPanel'

export const dynamic = 'force-dynamic'

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Read URL params — used to pre-seed initial criteria
  const params = await searchParams
  const isLeadMode = params.is_lead === 'true'

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const [
    { count: total },
    { count: highEquity },
    { count: thisWeek },
    { count: starred },
  ] = await Promise.all([
    supabase.from('properties').select('*', { count: 'exact', head: true }),
    supabase.from('properties').select('*', { count: 'exact', head: true }).eq('equity_tier', 'High'),
    supabase.from('properties').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('starred', true),
  ])

  // Pre-seed criteria from URL so "Leads" tab auto-filters to is_lead=true
  const initialCriteria: Partial<CriteriaState> = isLeadMode ? { is_lead: true } : {}

  return (
    <DashboardLayout>
      <PropertySearchClient
        initialStats={{
          total:      total      ?? 0,
          highEquity: highEquity ?? 0,
          thisWeek:   thisWeek   ?? 0,
          starred:    starred    ?? 0,
        }}
        initialCriteria={initialCriteria}
        mode={isLeadMode ? 'leads' : 'search'}
      />
    </DashboardLayout>
  )
}
