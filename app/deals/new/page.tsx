import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../../layout-dashboard'
import NewDealClient from './new-deal-client'

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ contact_id?: string }>
}) {
  const { contact_id } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, phone, address')
    .order('name', { ascending: true })

  return (
    <DashboardLayout>
      <NewDealClient contacts={contacts ?? []} defaultContactId={contact_id} />
    </DashboardLayout>
  )
}
