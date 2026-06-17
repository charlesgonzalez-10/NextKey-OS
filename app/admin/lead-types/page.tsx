import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import DashboardLayout from '../../layout-dashboard'
import LeadTypesClient from './lead-types-client'

export const metadata = { title: 'Lead Types — NextKey OS' }

export default async function LeadTypesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) redirect('/')

  return (
    <DashboardLayout>
      <LeadTypesClient />
    </DashboardLayout>
  )
}
