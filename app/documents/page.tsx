import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import DocumentsClient from './documents-client'

export const metadata = { title: 'Documents — NextKey OS' }

export default async function DocumentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <DashboardLayout>
      <DocumentsClient />
    </DashboardLayout>
  )
}
