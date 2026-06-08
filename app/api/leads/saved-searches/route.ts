/**
 * GET  /api/leads/saved-searches  — list all saved searches for the operator
 * POST /api/leads/saved-searches  — create a new saved search
 * Body: { name: string, emoji?: string, filters: object, is_shared?: boolean }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const service = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await service
    .from('lead_saved_searches')
    .select('*')
    .or(`owner.eq.${user.email},is_shared.eq.true`)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, emoji = '🔍', filters, is_shared = false } = body

  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!filters || typeof filters !== 'object') return NextResponse.json({ error: 'filters is required' }, { status: 400 })

  const { data, error } = await service
    .from('lead_saved_searches')
    .insert([{ name: name.trim(), emoji, filters, owner: user.email, is_shared }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
