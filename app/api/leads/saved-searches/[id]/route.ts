/**
 * DELETE /api/leads/saved-searches/[id]  — delete a saved search (owner only)
 * PATCH  /api/leads/saved-searches/[id]  — rename / update a saved search
 */
import { serviceClient } from '@/lib/supabase-service'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const service = serviceClient

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await service
    .from('lead_saved_searches')
    .delete()
    .eq('id', id)
    .eq('owner', user.email) // can only delete own searches

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const update: Record<string, unknown> = {}
  if (body.name)       update.name      = body.name.trim()
  if (body.emoji)      update.emoji     = body.emoji
  if (body.filters)    update.filters   = body.filters
  if ('is_shared' in body) update.is_shared = Boolean(body.is_shared)

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await service
    .from('lead_saved_searches')
    .update(update)
    .eq('id', id)
    .eq('owner', user.email)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
