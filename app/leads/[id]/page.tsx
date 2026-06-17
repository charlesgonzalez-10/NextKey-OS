import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { redirect, notFound } from 'next/navigation'
import DashboardLayout from '../../layout-dashboard'
import WorkspaceClient from './workspace-client'

export const dynamic = 'force-dynamic'

const service = serviceClient

export default async function LeadWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { id } = await params

  const { data: property, error } = await service
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !property) notFound()

  const { data: lead } = await service
    .from('leads')
    .select('*')
    .eq('property_id', id)
    .maybeSingle()

  const mergedLead = {
    ...property,
    lead_id:             lead?.id               ?? null,
    lead_status:         lead?.status           ?? null,
    pipeline_stage:      lead?.pipeline_stage   ?? property.pipeline_stage   ?? null,
    starred:             lead?.starred          ?? property.starred          ?? false,
    lead_score:          lead?.lead_score       ?? property.lead_score       ?? null,
    ai_score:            lead?.ai_score         ?? property.ai_score         ?? null,
    imported_to_contact: lead?.imported_to_contact ?? property.imported_to_contact ?? null,
    call_status:         lead?.call_status      ?? 'not_called',
    sms_status:          lead?.sms_status       ?? 'not_sent',
    email_status:        lead?.email_status     ?? 'not_sent',
    offer_sent:          lead?.offer_sent       ?? false,
    offer_pct:           lead?.offer_pct        ?? null,
    offer_amount:        lead?.offer_amount     ?? null,
    blocked:             lead?.blocked          ?? false,
    lead_added_at:       lead?.created_at       ?? property.created_at ?? null,
    is_lead:             !!lead,
  }

  const leadRowId = lead?.id ?? null

  const [
    { data: aiSummary },
    { data: notes },
    { data: comps },
    { data: documents },
    { data: leadContacts },
  ] = await Promise.all([
    service.from('lead_ai_summaries')
      .select('*')
      .eq('lead_id', id)
      .maybeSingle(),

    service.from('lead_notes')
      .select('id, body, author, created_at, note_type')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(50),

    service.from('lead_comps')
      .select('id, address, sale_price, list_price, status, beds, baths, sqft, year_built, distance_miles, price_per_sqft, sale_date')
      .eq('lead_id', id)
      .order('sale_date', { ascending: false })
      .limit(20),

    service.from('documents')
      .select('id, name, category, status, offer_amount, pdf_path, signed_pdf_path, created_at, updated_at, recipient_name')
      .eq('property_id', id)
      .order('created_at', { ascending: false })
      .limit(30),

    leadRowId
      ? service.from('lead_contacts')
          .select(`id, relationship_type, is_primary, notes, created_at,
                   contact:contact_id (id, name, phone, email, address, category, status)`)
          .eq('lead_id', leadRowId)
          .order('is_primary', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
  ])

  return (
    <DashboardLayout>
      <WorkspaceClient
        lead={mergedLead}
        aiSummary={aiSummary ?? null}
        notes={notes ?? []}
        comps={comps ?? []}
        documents={documents ?? []}
        contacts={(leadContacts ?? []) as never}
        deals={[]}
      />
    </DashboardLayout>
  )
}
