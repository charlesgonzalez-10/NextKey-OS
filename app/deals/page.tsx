import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import DealsClient from './deals-client'

export default async function DealsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: deals } = await supabase
    .from('deals')
    .select(`
      *,
      contacts ( name, phone )
    `)
    .order('created_at', { ascending: false })

  return (
    <DashboardLayout>
      <DealsClient deals={deals ?? []} />
    </DashboardLayout>
  )
}
