import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { RelationshipService } from '@/lib/relationshipService'

export const dynamic = 'force-dynamic'

// Category on the standalone "Add Contact" form → relationship role when the
// entered address matches an existing property.
const CATEGORY_TO_ROLE: Record<string, string> = {
  Seller: 'Owner',
  Buyer:  'Buyer',
  Agent:  'Agent',
  Lender: 'Lender',
}

// POST /api/contacts
// Body: { name, phone?, email?, address?, category?, tags?, notes?, lead_source?, lead_type_id?, vertical_id? }
//
// Reuses a matching existing contact (by phone/email/name) instead of ever
// duplicating one. If `address` matches exactly one existing property, the
// new/reused contact is linked to it via RelationshipService — this is the
// only path through which this page touches contact_properties.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    name, phone, email, address,
    category = 'Seller', tags, notes,
    lead_source, lead_type_id, vertical_id,
  } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  try {
    const { id: contactId } = await RelationshipService.findOrCreateContact({
      name, phone, email, address,
      source: lead_source?.trim() || 'Manual',
    })

    await serviceClient
      .from('contacts')
      .update({
        category,
        tags:          Array.isArray(tags) ? tags : [],
        notes:         notes || null,
        lead_source:   lead_source || null,
        lead_type_id:  lead_type_id || null,
        vertical_id:   vertical_id || null,
        status:        'Active',
      })
      .eq('id', contactId)

    let linkedPropertyId: string | null = null
    if (address?.trim()) {
      linkedPropertyId = await RelationshipService.findPropertyByAddress(address)
      if (linkedPropertyId) {
        await RelationshipService.linkPropertyContact(linkedPropertyId, contactId, {
          role: CATEGORY_TO_ROLE[category] ?? 'Other',
          primary: true,
        })
      }
    }

    return NextResponse.json({ id: contactId, linked_property_id: linkedPropertyId })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
