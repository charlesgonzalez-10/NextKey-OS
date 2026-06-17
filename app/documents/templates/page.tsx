import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../../layout-dashboard'
import TemplatesClient from './templates-client'

export const metadata = { title: 'Document Templates — NextKey OS' }

export default async function DocumentTemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <DashboardLayout>
      <TemplatesClient />
    </DashboardLayout>
  )
}
