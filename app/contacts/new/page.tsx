import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../../layout-dashboard'
import NewContactClient from './new-contact-client'

export default async function NewContactPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <DashboardLayout>
      <NewContactClient />
    </DashboardLayout>
  )
}
