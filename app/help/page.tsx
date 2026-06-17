import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import HelpClient from './help-client'

export const metadata = { title: 'Help Center — NextKey OS' }

export default async function HelpPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <DashboardLayout>
      <Suspense fallback={<div style={{ padding: 32, color: 'var(--c-text-2)' }}>Loading…</div>}>
        <HelpClient />
      </Suspense>
    </DashboardLayout>
  )
}
