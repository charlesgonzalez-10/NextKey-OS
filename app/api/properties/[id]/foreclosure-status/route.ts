/**
 * PATCH /api/properties/[id]/foreclosure-status
 *   Set a manual foreclosure status override on a property.
 *   Body: { status: string, notes?: string }
 *
 * DELETE /api/properties/[id]/foreclosure-status
 *   Reset to REAPI-derived status (clear the override).
 *
 * Both verbs write an activity entry to lead_notes.
 * REAPI ingestion never touches these fields — this is the only write path.
 */

import { NextRequest, NextResponse } from 'next/server'
import { serviceClient } from '@/lib/supabase-service'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set([
  'Active', 'Pending', 'Dismissed', 'Cancelled', 'Reinstated',
  'Sold at Auction', 'Certificate Issued', 'Final Judgment',
  'Bankruptcy Stay', 'Unknown',
])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: { status?: string; notes?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { status, notes } = body
  if (!status || !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
  }

  // Read previous override for the activity log
  const { data: prev } = await serviceClient
    .from('properties')
    .select('foreclosure_status_override')
    .eq('id', id)
    .single()

  const now = new Date().toISOString()

  const { error: updateErr } = await serviceClient
    .from('properties')
    .update({
      foreclosure_status_override:   status,
      foreclosure_status_source:     'Manual',
      foreclosure_status_updated_at: now,
      foreclosure_status_updated_by: user.id,
      foreclosure_notes:             notes ?? null,
      foreclosure_reapi_changed:     false,
      updated_at:                    now,
    })
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Activity log entry
  const prevStatus = prev?.foreclosure_status_override ?? null
  const noteBody = prevStatus
    ? `Foreclosure status changed: ${prevStatus} → ${status}${notes ? `\n${notes}` : ''}`
    : `Foreclosure status set: ${status}${notes ? `\n${notes}` : ''}`

  await serviceClient.from('lead_notes').insert({
    lead_id:   id,
    body:      noteBody,
    author:    user.email,
    note_type: 'note',
  })

  return NextResponse.json({
    foreclosure_status_override:   status,
    foreclosure_status_source:     'Manual',
    foreclosure_status_updated_at: now,
    foreclosure_notes:             notes ?? null,
    foreclosure_reapi_changed:     false,
  })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: prev } = await serviceClient
    .from('properties')
    .select('foreclosure_status_override')
    .eq('id', id)
    .single()

  const now = new Date().toISOString()

  const { error: updateErr } = await serviceClient
    .from('properties')
    .update({
      foreclosure_status_override:   null,
      foreclosure_status_source:     'REAPI',
      foreclosure_status_updated_at: now,
      foreclosure_status_updated_by: user.id,
      foreclosure_notes:             null,
      foreclosure_reapi_changed:     false,
      updated_at:                    now,
    })
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  const prevStatus = prev?.foreclosure_status_override
  if (prevStatus) {
    await serviceClient.from('lead_notes').insert({
      lead_id:   id,
      body:      `Foreclosure status reset to REAPI (was: ${prevStatus})`,
      author:    user.email,
      note_type: 'note',
    })
  }

  return NextResponse.json({
    foreclosure_status_override:   null,
    foreclosure_status_source:     'REAPI',
    foreclosure_status_updated_at: now,
    foreclosure_notes:             null,
    foreclosure_reapi_changed:     false,
  })
}
