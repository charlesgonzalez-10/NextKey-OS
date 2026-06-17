import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(req.url).searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json({ contacts: [], leads: [], deals: [], properties: [], documents: [] })

  const LIMIT = 5

  const [contacts, leads, deals, properties, documents] = await Promise.all([
    serviceClient
      .from('contacts')
      .select('id, name, phone, email, category')
      .or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,address.ilike.%${q}%`)
      .limit(LIMIT),

    serviceClient
      .from('leads')
      .select('id, property_address, owner_name, status, lead_score')
      .or(`property_address.ilike.%${q}%,owner_name.ilike.%${q}%`)
      .limit(LIMIT),

    serviceClient
      .from('deals')
      .select('id, address, status, offer_price')
      .ilike('address', `%${q}%`)
      .limit(LIMIT),

    serviceClient
      .from('properties')
      .select('id, property_address, owner_name, city, zip')
      .or(`property_address.ilike.%${q}%,owner_name.ilike.%${q}%`)
      .limit(LIMIT),

    serviceClient
      .from('documents')
      .select('id, name, category, status, recipient_name')
      .or(`name.ilike.%${q}%,recipient_name.ilike.%${q}%`)
      .limit(LIMIT),
  ])

  return NextResponse.json({
    contacts:   contacts.data   ?? [],
    leads:      leads.data      ?? [],
    deals:      deals.data      ?? [],
    properties: properties.data ?? [],
    documents:  documents.data  ?? [],
  })
}
