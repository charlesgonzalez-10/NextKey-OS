import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from './layout-dashboard'
import DashboardHome from './dashboard-home'

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Summary stats
  const [{ count: contactCount }, { count: dealCount }] = await Promise.all([
    supabase.from('contacts').select('*', { count: 'exact', head: true }),
    supabase.from('deals').select('*', { count: 'exact', head: true }),
  ])

  return (
    <DashboardLayout>
      <DashboardHome contactCount={contactCount ?? 0} dealCount={dealCount ?? 0} />
    </DashboardLayout>
  )
}
