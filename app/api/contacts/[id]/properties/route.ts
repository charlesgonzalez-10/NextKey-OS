import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { RelationshipService } from '@/lib/relationshipService'

export const dynamic = 'force-dynamic'

// GET /api/contacts/[id]/properties
// Returns all properties linked to this contact with relationship + lead/deal context
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: contactId } = await params

  try {
    const properties = await RelationshipService.getContactProperties(contactId)
    return NextResponse.json({ properties })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
