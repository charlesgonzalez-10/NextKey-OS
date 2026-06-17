import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

async function requireAdmin(user: { id: string; email?: string }) {
  const profile = await getUserProfile(user.id)
  return canAccessAdmin(profile, user.email)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await requireAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const updates: Record<string, unknown> = {}
  if (body.name        !== undefined) updates.name        = body.name.trim()
  if (body.color       !== undefined) updates.color       = body.color
  if (body.description !== undefined) updates.description = body.description
  if (body.is_active   !== undefined) updates.is_active   = body.is_active
  if (body.position    !== undefined) updates.position    = body.position

  const { data, error } = await serviceClient
    .from('business_verticals')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await requireAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { error } = await serviceClient.from('business_verticals').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
