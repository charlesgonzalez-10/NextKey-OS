import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

export async function PUT(req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  if (body.is_default) {
    await serviceClient
      .from('offer_profiles')
      .update({ is_default: false })
      .eq('user_id', user.id)
  }

  const { data, error } = await serviceClient
    .from('offer_profiles')
    .update({
      name:            body.name,
      buyer_name:      body.buyer_name      ?? null,
      closing_days:    body.closing_days    ?? null,
      inspection_days: body.inspection_days ?? null,
      earnest_money:   body.earnest_money   ?? null,
      default_clauses: body.default_clauses ?? null,
      is_default:      body.is_default      ?? false,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { error } = await serviceClient
    .from('offer_profiles')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
