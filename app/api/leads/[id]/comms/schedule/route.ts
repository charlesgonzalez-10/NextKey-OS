/**
 * GET  /api/leads/[id]/comms/schedule  — list scheduled follow-ups
 * POST /api/leads/[id]/comms/schedule  — create a scheduled follow-up
 * PATCH /api/leads/[id]/comms/schedule — cancel a scheduled item (body: { id, status })
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
    .from('lead_scheduled')
    .select('*')
    .eq('lead_id', leadId)
    .order('scheduled_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scheduled: data ?? [] })
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

  if (!body.type || !body.title || !body.scheduled_at) {
    return NextResponse.json({ error: 'type, title, and scheduled_at are required' }, { status: 400 })
  }

  const { data, error } = await serviceClient
    .from('lead_scheduled')
    .insert({
      lead_id:       leadId,
      contact_id:    body.contact_id ?? null,
      type:          body.type,
      title:         body.title,
      body:          body.body ?? null,
      subject:       body.subject ?? null,
      scheduled_at:  body.scheduled_at,
      status:        'pending',
      created_by:    user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data }, { status: 201 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await params
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await serviceClient
    .from('lead_scheduled')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}
