/**
 * GET  /api/leads/[id]/notes — fetch all notes for a lead
 * POST /api/leads/[id]/notes — create a new note
 */
import { serviceClient } from '@/lib/supabase-service'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const service = serviceClient

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data, error } = await service
    .from('lead_notes')
    .select('id, body, author, created_at, note_type')
    .eq('lead_id', id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const payload = await req.json()
  const body = payload.body
  const noteType = payload.note_type ?? 'note'

  if (!body?.trim()) return NextResponse.json({ error: 'body is required' }, { status: 400 })

  const { data, error } = await service
    .from('lead_notes')
    .insert([{ lead_id: id, body: body.trim(), author: user.email, note_type: noteType }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
