import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

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

  const { data, error } = await serviceClient
    .from('contact_properties')
    .select(`
      id,
      relationship_type,
      is_primary,
      notes,
      created_at,
      lead_id,
      property:property_id (
        id,
        property_address,
        city,
        zip,
        county,
        beds,
        baths,
        living_area,
        year_built,
        market_value,
        assessed_value,
        equity_tier,
        equity_percentage,
        is_pre_foreclosure,
        is_probate,
        is_auction,
        is_tax_deed,
        is_divorce
      )
    `)
    .eq('contact_id', contactId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ properties: data ?? [] })
}
