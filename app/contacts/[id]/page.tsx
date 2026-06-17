import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DashboardLayout from '../../layout-dashboard'
import ContactDetailClient from './contact-detail-client'

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .single()

  if (!contact) notFound()

  const { data: activities } = await supabase
    .from('activities')
    .select('*')
    .eq('contact_id', id)
    .order('created_at', { ascending: false })

  const { data: deals } = await supabase
    .from('deals')
    .select('id, address, status, arv, offer_price, closing_date, created_at')
    .eq('contact_id', id)
    .order('created_at', { ascending: false })

  const { data: messagesRaw } = await supabase
    .from('messages')
    .select('id, direction, body, status, created_at')
    .eq('contact_id', id)
    .order('created_at', { ascending: true })

  return (
    <DashboardLayout>
      <ContactDetailClient
        contact={contact}
        activities={(activities ?? []).filter(Boolean)}
        deals={(deals ?? []).filter(Boolean)}
        messages={(messagesRaw ?? []).filter((m): m is NonNullable<typeof m> => m != null)}
      />
    </DashboardLayout>
  )
}
