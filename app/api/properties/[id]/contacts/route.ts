import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

const svc = serviceClient

// Resolve properties.id → leads.id (optional — for storing the lead reference)
async function resolveLeadId(propertyId: string): Promise<string | null> {
  const { data } = await svc
    .from('leads')
    .select('id')
    .eq('property_id', propertyId)
    .maybeSingle()
  return data?.id ?? null
}

// GET /api/properties/[id]/contacts
// Returns all contacts linked to this property with relationship details
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: propertyId } = await params

  const { data, error } = await svc
    .from('contact_properties')
    .select(`
      id,
      relationship_type,
      is_primary,
      notes,
      created_at,
      lead_id,
      contact:contact_id (
        id, name, phone, email, address, category, status
      )
    `)
    .eq('property_id', propertyId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contacts: data ?? [] })
}

// POST /api/properties/[id]/contacts
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

  let contactId = existingContactId

  // Create new contact if no contact_id supplied
  if (!contactId) {
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required when creating a new contact' }, { status: 400 })
    }
    const { data: newContact, error: cErr } = await svc
      .from('contacts')
      .insert({
        name: name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        address: address?.trim() || null,
        source: 'Property Lead',
      })
      .select('id')
      .single()

    if (cErr || !newContact) {
      return NextResponse.json({ error: cErr?.message ?? 'Failed to create contact' }, { status: 500 })
    }
    contactId = newContact.id
  }

  // Optionally resolve lead_id for back-reference
  const leadId = await resolveLeadId(propertyId)

  // If marking as primary, clear existing primary for this property
  if (is_primary) {
    await svc
      .from('contact_properties')
      .update({ is_primary: false })
      .eq('property_id', propertyId)
  }

  const { data: link, error: lErr } = await svc
    .from('contact_properties')
    .upsert({
      contact_id: contactId,
      property_id: propertyId,
      lead_id: leadId,
      relationship_type,
      is_primary,
      notes: notes ?? null,
    }, { onConflict: 'contact_id,property_id' })
    .select(`
      id, relationship_type, is_primary, notes, created_at, lead_id,
      contact:contact_id (id, name, phone, email, address, category, status)
    `)
    .single()

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })
  return NextResponse.json({ link })
}
