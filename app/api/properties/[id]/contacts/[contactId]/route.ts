import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

const svc = serviceClient

// PATCH /api/properties/[id]/contacts/[contactId]
// Body: { relationship_type?, is_primary?, notes? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: propertyId, contactId } = await params
  const { relationship_type, is_primary, notes } = await req.json()

  // When marking primary, clear others first
  if (is_primary === true) {
    await svc
      .from('contact_properties')
      .update({ is_primary: false })
      .eq('property_id', propertyId)
  }

  const patch: Record<string, unknown> = {}
  if (relationship_type !== undefined) patch.relationship_type = relationship_type
  if (is_primary       !== undefined) patch.is_primary       = is_primary
  if (notes            !== undefined) patch.notes            = notes

  const { data, error } = await svc
    .from('contact_properties')
    .update(patch)
    .eq('property_id', propertyId)
    .eq('contact_id', contactId)
    .select(`
      id, relationship_type, is_primary, notes,
      contact:contact_id (id, name, phone, email, address, category)
    `)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ link: data })
}

// DELETE /api/properties/[id]/contacts/[contactId]
// Removes the contact from this property (does NOT delete the contact record)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: propertyId, contactId } = await params

  const { error } = await svc
    .from('contact_properties')
    .delete()
    .eq('property_id', propertyId)
    .eq('contact_id', contactId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
