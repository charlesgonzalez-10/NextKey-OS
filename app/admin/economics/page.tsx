import { createClient }              from '@/lib/supabase/server'
import { redirect }                   from 'next/navigation'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import DashboardLayout                from '../../layout-dashboard'
import AdminEconomicsClient           from './economics-client'

export const metadata = { title: 'Economics — NextKey OS' }

export default async function AdminEconomicsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) redirect('/')

  return (
    <DashboardLayout>
      <AdminEconomicsClient />
    </DashboardLayout>
  )
}
