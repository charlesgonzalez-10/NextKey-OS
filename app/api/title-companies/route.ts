import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await serviceClient
    .from('title_companies')
    .select('*')
    .eq('user_id', user.id)
    .order('is_default', { ascending: false })
    .order('company_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!body.company_name?.trim()) {
    return NextResponse.json({ error: 'company_name required' }, { status: 400 })
  }

  // If marking as default, clear existing default first
  if (body.is_default) {
    await serviceClient
      .from('title_companies')
      .update({ is_default: false })
      .eq('user_id', user.id)
  }

  const { data, error } = await serviceClient
    .from('title_companies')
    .insert({
      user_id:      user.id,
      company_name: body.company_name,
      contact_name: body.contact_name ?? null,
      email:        body.email        ?? null,
      phone:        body.phone        ?? null,
      address:      body.address      ?? null,
      notes:        body.notes        ?? null,
      is_default:   body.is_default   ?? false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
