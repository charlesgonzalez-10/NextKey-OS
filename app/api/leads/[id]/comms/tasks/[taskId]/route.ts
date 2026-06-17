/**
 * PATCH  /api/leads/[id]/comms/tasks/[taskId]  — update / complete a task
 * DELETE /api/leads/[id]/comms/tasks/[taskId]  — delete a task
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { taskId } = await params
  const updates = await req.json()

  if (updates.status === 'completed') {
    updates.completed_at = new Date().toISOString()
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await serviceClient
    .from('tasks')
    .update(updates)
    .eq('id', taskId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { taskId } = await params
  const { error } = await serviceClient.from('tasks').delete().eq('id', taskId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
