import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import PipelineClient from './pipeline-client'

export default async function PipelinePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [dealsRes, pipelinesRes] = await Promise.all([
    serviceClient
      .from('deals')
      .select(`id, address, status, pipeline_id, pipeline_stage_id, arv, offer_price, repair_cost, closing_cost, created_at, contacts(name)`)
      .not('status', 'in', '("Closed","Dead")')
      .order('created_at', { ascending: false }),

    serviceClient
      .from('pipelines')
      .select('*, pipeline_stages(id, name, position, color, probability, is_closed_won, is_closed_lost)')
      .eq('is_active', true)
      .order('position', { ascending: true }),
  ])

  const deals = (dealsRes.data ?? []).map(d => ({
    ...d,
    pipeline_stages: undefined,
  }))

  const pipelines = (pipelinesRes.data ?? []).map(p => ({
    ...p,
    pipeline_stages: (p.pipeline_stages ?? []).sort(
      (a: { position: number }, b: { position: number }) => a.position - b.position
    ),
  }))

  return (
    <DashboardLayout>
      <PipelineClient deals={deals} pipelines={pipelines} />
    </DashboardLayout>
  )
}
