/**
 * PATCH /api/leads/[id]/stage
 *
 * Updates workflow fields (pipeline_stage, starred, lead_score) on a lead.
 * [id] = properties.id — we update the leads table WHERE property_id = id.
 *
 * If no lead record exists yet (property not yet in leads), this creates one.
 * Body: { pipeline_stage?, starred?, lead_score? }
 */
import { serviceClient } from '@/lib/supabase-service'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const service = serviceClient

const VALID_STAGES = ['reviewing', 'contacted', 'offer', 'dead', 'blocked', null]

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params   // id = properties.id
  const body = await req.json()

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if ('pipeline_stage' in body) {
    if (!VALID_STAGES.includes(body.pipeline_stage)) {
      return NextResponse.json({ error: 'Invalid pipeline_stage' }, { status: 400 })
    }
    update.pipeline_stage = body.pipeline_stage
    // Also update lead status to match stage (if pipeline_stage is set)
    if (body.pipeline_stage && body.pipeline_stage !== null) {
      update.status = body.pipeline_stage
    }
  }

  if ('starred'       in body) update.starred       = Boolean(body.starred)
  if ('lead_score'    in body) update.lead_score    = body.lead_score
  if ('lead_type_id'  in body) update.lead_type_id  = body.lead_type_id  ?? null
  if ('vertical_id'   in body) update.vertical_id   = body.vertical_id   ?? null
  if ('lead_source'   in body) update.lead_source   = body.lead_source   ?? null
  // Action tracking fields
  if ('call_status'   in body) update.call_status   = body.call_status   ?? null
  if ('sms_status'    in body) update.sms_status    = body.sms_status    ?? null
  if ('email_status'  in body) update.email_status  = body.email_status  ?? null
  if ('offer_sent'    in body) update.offer_sent    = Boolean(body.offer_sent)
  if ('offer_pct'     in body) update.offer_pct     = body.offer_pct     ?? null
  if ('offer_amount'  in body) update.offer_amount  = body.offer_amount  ?? null
  if ('blocked'       in body) update.blocked       = Boolean(body.blocked)

  if (Object.keys(update).length <= 1) {  // only updated_at
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Upsert: update leads by property_id, or create lead if not yet exists
  const { data: existing } = await service
    .from('leads')
    .select('id')
    .eq('property_id', id)
    .maybeSingle()

  if (existing) {
    const { error } = await service
      .from('leads')
      .update(update)
      .eq('property_id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Property exists but no lead yet — create one with the update fields
    const { error } = await service
      .from('leads')
      .insert([{ property_id: id, source: 'manual', ...update }])

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updated: update })
}
