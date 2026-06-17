import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

const svc = serviceClient

async function getLeadId(propertyId: string): Promise<string | null> {
  const { data } = await svc
    .from('leads')
    .select('id')
    .eq('property_id', propertyId)
    .maybeSingle()
  return data?.id ?? null
}

// PATCH /api/leads/[id]/contacts/[contactId]
// Body: { relationship_type?, is_primary?, notes? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: propertyId, contactId } = await params
  const leadId = await getLeadId(propertyId)
  if (!leadId) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const { relationship_type, is_primary, notes } = await req.json()

  // When marking primary, clear others first
  if (is_primary === true) {
    await svc.from('lead_contacts').update({ is_primary: false }).eq('lead_id', leadId)
  }

  const patch: Record<string, unknown> = {}
  if (relationship_type !== undefined) patch.relationship_type = relationship_type
  if (is_primary       !== undefined) patch.is_primary       = is_primary
  if (notes            !== undefined) patch.notes            = notes

  const { data, error } = await svc
    .from('lead_contacts')
    .update(patch)
    .eq('lead_id', leadId)
    .eq('contact_id', contactId)
    .select(`
      id, relationship_type, is_primary, notes,
      contact:contact_id (id, name, phone, email, address, category)
    `)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ link: data })
}

// DELETE /api/leads/[id]/contacts/[contactId]
// Removes the contact from this lead (does NOT delete the contact itself)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: propertyId, contactId } = await params
  const leadId = await getLeadId(propertyId)
  if (!leadId) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const { error } = await svc
    .from('lead_contacts')
    .delete()
    .eq('lead_id', leadId)
    .eq('contact_id', contactId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
