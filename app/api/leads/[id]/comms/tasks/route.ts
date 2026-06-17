/**
 * GET  /api/leads/[id]/comms/tasks  — list tasks for a lead
 * POST /api/leads/[id]/comms/tasks  — create a task linked to a lead
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: leadId } = await params
  const { data, error } = await serviceClient
    .from('tasks')
    .select('id, title, description, due_date, priority, status, completed_at, created_at')
    .eq('lead_id', leadId)
    .order('status')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tasks: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: leadId } = await params
  const body = await req.json()

  const { data, error } = await serviceClient
    .from('tasks')
    .insert({
      lead_id:     leadId,
      contact_id:  body.contact_id ?? null,
      title:       body.title,
      description: body.description ?? null,
      due_date:    body.due_date ?? null,
      priority:    body.priority ?? 'normal',
      status:      'pending',
      created_by:  user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Also log to timeline
  await serviceClient.from('lead_notes').insert({
    lead_id: leadId,
    body: `Task created: ${body.title}${body.due_date ? ` (due ${body.due_date})` : ''}`,
    author: user.email,
    note_type: 'task',
  })

  return NextResponse.json({ task: data }, { status: 201 })
}
