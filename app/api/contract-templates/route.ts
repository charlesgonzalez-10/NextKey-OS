import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await serviceClient
    .from('contract_templates')
    .select('id, name, description, category, file_path, page_count, current_version_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json([])

  // Fetch draft field counts in one batch query
  const ids = data.map(t => t.id)
  const { data: fieldRows } = await serviceClient
    .from('template_fields')
    .select('blueprint_id')
    .in('blueprint_id', ids)
    .is('blueprint_version_id', null)

  const draftCountById: Record<string, number> = {}
  for (const row of fieldRows ?? []) {
    draftCountById[row.blueprint_id] = (draftCountById[row.blueprint_id] ?? 0) + 1
  }

  return NextResponse.json(data.map(t => ({ ...t, draft_field_count: draftCountById[t.id] ?? 0 })))
}

// Called after client uploads directly to Supabase storage
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path, name, category, page_count } = await req.json()
  if (!path || !name) return NextResponse.json({ error: 'path and name are required' }, { status: 400 })

  const { data, error } = await serviceClient
    .from('contract_templates')
    .insert({ user_id: user.id, name, category: category ?? 'other', file_path: path, page_count: page_count ?? null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
