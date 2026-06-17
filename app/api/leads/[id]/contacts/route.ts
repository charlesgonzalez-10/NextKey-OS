import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

const svc = serviceClient

// Resolve properties.id → leads.id, creating the lead row if needed
async function resolveLeadId(propertyId: string): Promise<string | null> {
  const { data: existing } = await svc
    .from('leads')
    .select('id')
    .eq('property_id', propertyId)
    .maybeSingle()

  if (existing) return existing.id

  // Auto-create a lead record for this property
  const { data: created, error } = await svc
    .from('leads')
    .insert({ property_id: propertyId, status: 'new' })
    .select('id')
    .single()

  if (error || !created) return null
  return created.id
}

// GET /api/leads/[id]/contacts
// Returns all contacts linked to this lead, with their relationship details
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: propertyId } = await params
  const leadId = await resolveLeadId(propertyId)
  if (!leadId) return NextResponse.json({ contacts: [] })

  const { data, error } = await svc
    .from('lead_contacts')
    .select(`
      id,
      relationship_type,
      is_primary,
      notes,
      created_at,
      contact:contact_id (
        id, name, phone, email, address, category, status
      )
    `)
    .eq('lead_id', leadId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contacts: data ?? [] })
}

// POST /api/leads/[id]/contacts
// Body: { contact_id?, name?, phone?, email?, address?, relationship_type, is_primary?, notes? }
// If contact_id provided → link existing contact
// Otherwise → create new contact then link
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: propertyId } = await params
  const body = await req.json()

  const {
    contact_id: existingContactId,
    name, phone, email, address,
    relationship_type = 'Owner',
    is_primary = false,
    notes,
  } = body

  const leadId = await resolveLeadId(propertyId)
  if (!leadId) return NextResponse.json({ error: 'Could not resolve lead' }, { status: 500 })

  let contactId = existingContactId

  // Create new contact if no contact_id supplied
  if (!contactId) {
    if (!name?.trim()) return NextResponse.json({ error: 'name is required when creating a new contact' }, { status: 400 })

    const { data: newContact, error: cErr } = await svc
      .from('contacts')
      .insert({ name: name.trim(), phone: phone?.trim() || null, email: email?.trim() || null, address: address?.trim() || null, source: 'Lead' })
      .select('id')
      .single()

    if (cErr || !newContact) return NextResponse.json({ error: cErr?.message ?? 'Failed to create contact' }, { status: 500 })
    contactId = newContact.id
  }

  // If marking as primary, clear existing primary for this lead
  if (is_primary) {
    await svc.from('lead_contacts').update({ is_primary: false }).eq('lead_id', leadId)
  }

  const { data: link, error: lErr } = await svc
    .from('lead_contacts')
    .upsert({
      lead_id: leadId,
      contact_id: contactId,
      relationship_type,
      is_primary,
      notes: notes ?? null,
    }, { onConflict: 'lead_id,contact_id' })
    .select(`
      id, relationship_type, is_primary, notes, created_at,
      contact:contact_id (id, name, phone, email, address, category, status)
    `)
    .single()

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })
  return NextResponse.json({ link })
}
