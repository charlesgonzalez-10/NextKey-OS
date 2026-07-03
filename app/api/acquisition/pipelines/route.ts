import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await serviceClient
    .from('acquisition_pipelines')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ pipelines: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, slug, color, icon, description, sort_order } = body

  if (!name?.trim() || !slug?.trim()) {
    return NextResponse.json({ error: 'name and slug required' }, { status: 400 })
  }

  const { data, error } = await serviceClient
    .from('acquisition_pipelines')
    .insert({ name, slug, color, icon, description, sort_order, created_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ pipeline: data }, { status: 201 })
}
