/**
 * POST /api/properties/[id]/add-lead
 *
 * Adds a property to the leads table (marks it as "I want to pursue this").
 * Creates the lead record if it doesn't exist, or updates status back to 'new'
 * if it was previously marked dead.
 *
 * [id] = properties.id
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
  const body = await req.json().catch(() => ({}))
  const source = body.source || 'manual'

  // Verify the property exists
  const { data: property, error: propErr } = await service
    .from('properties')
    .select('id, property_address')
    .eq('id', id)
    .single()

  if (propErr || !property) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 })
  }

  // Check for existing lead record (scoped to this user)
  const { data: existing } = await service
    .from('leads')
    .select('id, status')
    .eq('property_id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'dead') {
      // Re-activate a dead lead
      await service.from('leads').update({
        status:     'new',
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id)
      return NextResponse.json({ ok: true, lead_id: existing.id, action: 'reactivated' })
    }
    return NextResponse.json({ ok: true, lead_id: existing.id, action: 'already_exists' })
  }

  // Create new lead record
  const { data: newLead, error: insertErr } = await service
    .from('leads')
    .insert([{
      property_id: id,
      user_id:     user.id,
      status:      'new',
      source,
    }])
    .select('id')
    .single()

  if (insertErr || !newLead) {
    return NextResponse.json({ error: insertErr?.message || 'Failed to create lead' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, lead_id: newLead.id, action: 'created' })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Mark lead as dead (soft delete — we don't remove the property from DB)
  const { error } = await service
    .from('leads')
    .update({ status: 'dead', updated_at: new Date().toISOString() })
    .eq('property_id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
