/**
 * GET  /api/acquisition/call-log?lead_id=<id>   — list call logs for a lead
 * POST /api/acquisition/call-log                 — create a call log entry
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

const VALID_OUTCOMES = ['answered', 'no_answer', 'voicemail', 'wrong_number', 'disconnected', 'callback_scheduled'] as const
type Outcome = typeof VALID_OUTCOMES[number]

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lead_id = req.nextUrl.searchParams.get('lead_id')
  if (!lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })

  const { data, error } = await serviceClient
    .from('call_log')
    .select('*')
    .eq('lead_id', lead_id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ calls: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    lead_id: string
    outcome: Outcome
    notes?: string
    phone_used?: string
    duration_secs?: number
    follow_up_at?: string | null
    contact_id?: string | null
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { lead_id, outcome, notes, phone_used, duration_secs, follow_up_at, contact_id } = body

  if (!lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
  if (!VALID_OUTCOMES.includes(outcome)) {
    return NextResponse.json({ error: `Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(', ')}` }, { status: 400 })
  }

  const { data, error } = await serviceClient
    .from('call_log')
    .insert({
      lead_id,
      contact_id:    contact_id ?? null,
      outcome,
      notes:         notes?.trim()  || null,
      phone_used:    phone_used     || null,
      duration_secs: duration_secs  ?? null,
      follow_up_at:  follow_up_at   ?? null,
      created_by:    user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update last_contact_at on the lead and optionally follow_up_at
  const leadUpdate: Record<string, unknown> = {
    last_contact_at: new Date().toISOString(),
    call_status: outcome === 'answered' ? 'talked' :
                 outcome === 'no_answer' ? 'no_answer' :
                 outcome === 'voicemail' ? 'voicemail' : 'called',
    updated_at: new Date().toISOString(),
  }
  if (follow_up_at !== undefined) leadUpdate.follow_up_at = follow_up_at

  void serviceClient
    .from('leads')
    .update(leadUpdate)
    .eq('property_id', lead_id)
    .then(() => {}, () => {})

  return NextResponse.json({ call: data }, { status: 201 })
}
