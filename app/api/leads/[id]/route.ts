/**
 * GET /api/leads/[id]
 *
 * Returns a full property + lead record plus all related data.
 * [id] = properties.id (same UUID as the old scraper_leads.id after migration)
 *
 * Includes:
 *   - property data (from properties table)
 *   - lead workflow data (from leads table via property_id)
 *   - AI summary, comps, notes (from child tables via lead_id = properties.id)
 *   - Messages + contact (if added to pipeline)
 */
import { serviceClient } from '@/lib/supabase-service'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const service = serviceClient

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Delete lead row first (FK to properties)
  await service.from('leads').delete().eq('property_id', id)
  // Delete the property (cascades to lead_notes, lead_ai_summaries, etc.)
  const { error } = await service.from('properties').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: id })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Fetch property (was scraper_leads, now properties)
  const { data: property, error } = await service
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !property) return NextResponse.json({ error: 'Property not found' }, { status: 404 })

  // Fetch lead record (workflow data) by property_id
  const { data: lead } = await service
    .from('leads')
    .select('*')
    .eq('property_id', id)
    .maybeSingle()

  // Fetch child data — child tables still use lead_id = properties.id
  const [
    { data: aiSummary },
    { data: comps },
    { data: notes },
  ] = await Promise.all([
    service.from('lead_ai_summaries').select('*').eq('lead_id', id).maybeSingle(),
    service.from('lead_comps').select('*').eq('lead_id', id).order('sale_date', { ascending: false }),
    service.from('lead_notes').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
  ])

  let messages: unknown[] = []
  let contact: unknown = null

  // Use imported_to_contact from either property or lead
  const contactId = lead?.imported_to_contact ?? property.imported_to_contact
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

  // Merge property + lead into a flat object for backward compat
  const merged = {
    ...property,
    // Overlay lead workflow fields
    lead_id:             lead?.id              ?? null,
    lead_status:         lead?.status          ?? null,
    pipeline_stage:      lead?.pipeline_stage  ?? property.pipeline_stage ?? null,
    starred:             lead?.starred         ?? property.starred ?? false,
    lead_score:          lead?.lead_score       ?? property.lead_score ?? null,
    ai_score:            lead?.ai_score         ?? property.ai_score ?? null,
    imported_to_contact: lead?.imported_to_contact ?? property.imported_to_contact ?? null,
    is_lead:             !!lead,
    // Classification fields (stored on leads table)
    lead_type_id:        lead?.lead_type_id  ?? null,
    vertical_id:         lead?.vertical_id   ?? null,
  }

  return NextResponse.json({
    lead:       merged,   // kept as 'lead' for backward compat with LeadDetailClient
    property:   merged,   // also exposed as 'property' for new code
    aiSummary:  aiSummary || null,
    comps:      comps     || [],
    notes:      notes     || [],
    messages,
    contact,
  })
}
