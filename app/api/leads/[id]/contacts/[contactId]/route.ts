import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { RelationshipService } from '@/lib/relationshipService'

export const dynamic = 'force-dynamic'

// NOTE: `id` here is properties.id — see route.ts in this folder for context.

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
  const { relationship_type, is_primary, notes } = await req.json()

  try {
    const link = await RelationshipService.updatePropertyContactRole(propertyId, contactId, {
      relationship_type, is_primary, notes,
    })
    return NextResponse.json({ link })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}

// DELETE /api/leads/[id]/contacts/[contactId]
// Removes the contact from this property (does NOT delete the contact itself)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: propertyId, contactId } = await params

  try {
    await RelationshipService.unlinkPropertyContact(propertyId, contactId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
