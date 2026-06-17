import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import DashboardLayout from '../../layout-dashboard'
import UsersClient from './users-client'

export const metadata = { title: 'User Management — NextKey OS' }

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) redirect('/')

  return (
    <DashboardLayout>
      <UsersClient />
    </DashboardLayout>
  )
}
