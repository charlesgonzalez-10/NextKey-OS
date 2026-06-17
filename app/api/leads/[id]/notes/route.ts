/**
 * POST /api/leads/[id]/notes
 * Saves an operator note for a lead (pre-import, before contact is created).
 * Body: { body: string }
 */
import { serviceClient } from '@/lib/supabase-service'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const service = serviceClient

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { body } = await req.json()

  if (!body?.trim()) return NextResponse.json({ error: 'body is required' }, { status: 400 })

  const { data, error } = await service
    .from('lead_notes')
    .insert([{ lead_id: id, body: body.trim(), author: user.email }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
