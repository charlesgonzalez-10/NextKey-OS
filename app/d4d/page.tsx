import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/app/layout-dashboard'
import D4DClient from './d4d-client'

export default async function D4DPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <DashboardLayout>
      <D4DClient />
    </DashboardLayout>
  )
}
