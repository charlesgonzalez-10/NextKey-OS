import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardLayout from '../layout-dashboard'
import SignSessionsClient from './sessions-client'

export const dynamic = 'force-dynamic'

export default async function SignSessionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <DashboardLayout>
      <SignSessionsClient />
    </DashboardLayout>
  )
}
