import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await serviceClient
    .from('offer_profiles')
    .select('*')
    .eq('user_id', user.id)
    .order('is_default', { ascending: false })
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }

  if (body.is_default) {
    await serviceClient
      .from('offer_profiles')
      .update({ is_default: false })
      .eq('user_id', user.id)
  }

  const { data, error } = await serviceClient
    .from('offer_profiles')
    .insert({
      user_id:         user.id,
      name:            body.name,
      buyer_name:      body.buyer_name      ?? null,
      closing_days:    body.closing_days    ?? null,
      inspection_days: body.inspection_days ?? null,
      earnest_money:   body.earnest_money   ?? null,
      default_clauses: body.default_clauses ?? null,
      is_default:      body.is_default      ?? false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
