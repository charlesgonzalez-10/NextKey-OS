import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { RelationshipService } from '@/lib/relationshipService'

export const dynamic = 'force-dynamic'

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

  try {
    const contacts = await RelationshipService.getPropertyContacts(propertyId)
    return NextResponse.json({ contacts })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}

// POST /api/properties/[id]/contacts
// Body: { contact_id?, name?, phone?, email?, address?, relationship_type, is_primary?, notes? }
// If contact_id provided → link existing contact
// Otherwise → reuse a matching existing contact (by phone/email/name) or create a new one, then link
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

  if (!existingContactId && !name?.trim()) {
    return NextResponse.json({ error: 'name is required when creating a new contact' }, { status: 400 })
  }

  try {
    const { id: contactId } = await RelationshipService.findOrCreateContact({
      contact_id: existingContactId,
      name, phone, email, address,
      source: 'Property Lead',
    })

    const link = await RelationshipService.linkPropertyContact(propertyId, contactId, {
      role: relationship_type,
      primary: is_primary,
      notes,
    })

    return NextResponse.json({ link })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
