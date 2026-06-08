import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import PipelineClient from './pipeline-client'

export default async function PipelinePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: deals } = await supabase
    .from('deals')
    .select(`id, address, status, arv, offer_price, repair_cost, closing_cost, created_at, contacts ( name )`)
    .not('status', 'in', '("Closed","Dead")')
    .order('created_at', { ascending: false })

  return (
    <DashboardLayout>
      <PipelineClient deals={(deals ?? []).filter(Boolean)} />
    </DashboardLayout>
  )
}
