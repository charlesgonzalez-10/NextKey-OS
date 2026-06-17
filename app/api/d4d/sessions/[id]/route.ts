import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

// PATCH /api/d4d/sessions/[id] — append route points or end session
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  // Verify ownership
  const { data: session } = await serviceClient
    .from('d4d_sessions')
    .select('id, route, lead_count')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const updates: Record<string, unknown> = {}

  if (body.route_points) {
    // Append new GPS points to existing route
    const current = (session.route as object[]) ?? []
    updates.route = [...current, ...body.route_points]
  }

  if (body.end) {
    updates.ended_at = new Date().toISOString()
  }

  if (body.name !== undefined) {
    updates.name = body.name
  }

  if (body.increment_lead_count) {
    updates.lead_count = (session.lead_count ?? 0) + 1
  }

  const { data, error } = await serviceClient
    .from('d4d_sessions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ session: data })
}
