import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import BillingClient from './billing-client'

export const metadata = { title: 'Credits & Billing — NextKey OS' }

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <DashboardLayout>
      <BillingClient />
    </DashboardLayout>
  )
}
