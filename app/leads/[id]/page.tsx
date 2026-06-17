import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { redirect, notFound } from 'next/navigation'
import DashboardLayout from '../../layout-dashboard'
import LeadDetailClient from './lead-detail-client'

export const dynamic = 'force-dynamic'

// serviceClient is a lazy Proxy — createClient only runs at first request-time access
const service = serviceClient

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { id } = await params

  // Fetch property (was scraper_leads, now properties — same UUID)
  const { data: property, error } = await service
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !property) notFound()

  // Fetch lead record (workflow data)
  const { data: lead } = await service
    .from('leads')
    .select('*')
    .eq('property_id', id)
    .maybeSingle()

  // Merge property + lead for backward compat with LeadDetailClient
  const merged = {
    ...property,
    lead_id:             lead?.id              ?? null,
    lead_status:         lead?.status          ?? null,
    pipeline_stage:      lead?.pipeline_stage  ?? property.pipeline_stage ?? null,
    starred:             lead?.starred         ?? property.starred ?? false,
    lead_score:          lead?.lead_score       ?? property.lead_score ?? null,
    ai_score:            lead?.ai_score         ?? property.ai_score ?? null,
    imported_to_contact: lead?.imported_to_contact ?? property.imported_to_contact ?? null,
    is_lead:             !!lead,
  }

  // Fetch related data — child tables use lead_id = properties.id
  const [
    { data: aiSummary },
    { data: notes },
    { data: comps },
  ] = await Promise.all([
    service.from('lead_ai_summaries').select('*').eq('lead_id', id).maybeSingle(),
    service.from('lead_notes').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
    service.from('lead_comps').select('*').eq('lead_id', id).order('sale_date', { ascending: false }),
  ])

  let messages: unknown[] = []
  let contact:  unknown   = null

  const contactId = merged.imported_to_contact
  if (contactId) {
    const [msgRes, ctRes] = await Promise.all([
      service
        .from('messages')
        .select('id, direction, body, status, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true }),
      service
        .from('contacts')
        .select('id, name, phone, email')
        .eq('id', contactId)
        .single(),
    ])
    messages = msgRes.data || []
    contact  = ctRes.data  || null
  }

  return (
    <DashboardLayout>
      <LeadDetailClient
        lead={merged}
        aiSummary={aiSummary ?? null}
        notes={notes ?? []}
        comps={comps ?? []}
        messages={messages}
        contact={contact}
      />
    </DashboardLayout>
  )
}
