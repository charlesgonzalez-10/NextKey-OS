import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q     = searchParams.get('q')?.trim()
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 50)

  const contactId = searchParams.get('contact_id')?.trim()

  let query = serviceClient
    .from('deals')
    .select('id, address, status, offer_price, arv, contact_id')
    .neq('status', 'Dead')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (q)         query = query.ilike('address', `%${q}%`)
  if (contactId) query = query.eq('contact_id', contactId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deals: data ?? [] })
}
