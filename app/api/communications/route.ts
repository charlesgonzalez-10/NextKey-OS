import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const contact_id  = searchParams.get('contact_id')
  const lead_id     = searchParams.get('lead_id')
  const deal_id     = searchParams.get('deal_id')
  const property_id = searchParams.get('property_id')
  const type        = searchParams.get('type')
  const limit       = parseInt(searchParams.get('limit') ?? '50', 10)

  let query = serviceClient
    .from('communications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  const thread_id = searchParams.get('thread_id')

  if (contact_id)  query = query.eq('contact_id', contact_id)
  if (lead_id)     query = query.eq('lead_id', lead_id)
  if (deal_id)     query = query.eq('deal_id', deal_id)
  if (property_id) query = query.eq('property_id', property_id)
  if (type)        query = query.eq('type', type)
  if (thread_id)   query = query.eq('thread_id', thread_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ communications: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { data, error } = await serviceClient
    .from('communications')
    .insert(body)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
