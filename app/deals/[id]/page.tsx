import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DashboardLayout from '../../layout-dashboard'
import DealDetailClient from './deal-detail-client'

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: deal } = await supabase
    .from('deals')
    .select(`*, contacts ( id, name, phone, email )`)
    .eq('id', id)
    .single()

  if (!deal) notFound()

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name')
    .order('name', { ascending: true })

  return (
    <DashboardLayout>
      <DealDetailClient deal={deal} contacts={contacts ?? []} />
    </DashboardLayout>
  )
}
