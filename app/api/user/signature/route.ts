import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await serviceClient
    .from('user_profiles')
    .select('signature_data, my_name, my_phone, my_email, company_name')
    .eq('id', user.id)
    .single()

  return NextResponse.json(data ?? {})
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const fields: Record<string, unknown> = {}

  if (body.signature_data !== undefined) fields.signature_data = body.signature_data || null
  if (body.my_name        !== undefined) fields.my_name        = body.my_name
  if (body.my_phone       !== undefined) fields.my_phone       = body.my_phone
  if (body.my_email       !== undefined) fields.my_email       = body.my_email
  if (body.company_name   !== undefined) fields.company_name   = body.company_name

  // Try UPDATE first; if no row exists yet, INSERT
  const { data: updated, error: updateErr } = await serviceClient
    .from('user_profiles')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .select('id')

  if (updateErr) {
    console.error('[signature POST] update error:', updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  if (!updated || updated.length === 0) {
    // No profile row yet — create it
    const { error: insertErr } = await serviceClient
      .from('user_profiles')
      .insert({ id: user.id, ...fields })

    if (insertErr) {
      console.error('[signature POST] insert error:', insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
