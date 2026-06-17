import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import PreferencesClient from './preferences-client'

export const metadata = { title: 'Preferences — NextKey OS' }

export default async function PreferencesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <DashboardLayout>
      <Suspense fallback={<div style={{ padding: 32, color: 'var(--c-text-2)' }}>Loading…</div>}>
        <PreferencesClient />
      </Suspense>
    </DashboardLayout>
  )
}
