import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import DashboardLayout from '../layout-dashboard'
import IntegrationsClient from './integrations-client'

export const metadata = { title: 'Integrations — NextKey OS' }

export default async function IntegrationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) redirect('/')

  return (
    <DashboardLayout>
      <Suspense fallback={<div style={{ padding: 32, color: 'var(--c-text-2)' }}>Loading…</div>}>
        <IntegrationsClient />
      </Suspense>
    </DashboardLayout>
  )
}
