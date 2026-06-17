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

  const { id: contactId } = await params
  const { data, error } = await serviceClient
    .from('tasks')
    .select('*')
    .eq('contact_id', contactId)
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

  const { id: contactId } = await params
  const body = await req.json()

  const { data, error } = await serviceClient
    .from('tasks')
    .insert([{
      contact_id:  contactId,
      title:       body.title,
      description: body.description ?? null,
      due_date:    body.due_date ?? null,
      priority:    body.priority ?? 'normal',
      status:      'pending',
      assigned_to: body.assigned_to ?? null,
      created_by:  user.id,
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await params
  const body = await req.json()
  const { task_id, ...updates } = body
  if (!task_id) return NextResponse.json({ error: 'task_id required' }, { status: 400 })

  if (updates.status === 'completed') {
    updates.completed_at = new Date().toISOString()
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await serviceClient
    .from('tasks')
    .update(updates)
    .eq('id', task_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}
