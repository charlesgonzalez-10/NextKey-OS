import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import DashboardLayout from '../../layout-dashboard'
import VerticalsClient from './verticals-client'

export const metadata = { title: 'Business Verticals — NextKey OS' }

export default async function VerticalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) redirect('/')

  return (
    <DashboardLayout>
      <VerticalsClient />
    </DashboardLayout>
  )
}
