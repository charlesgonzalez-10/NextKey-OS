/**
 * GET  /api/properties/[id]/skiptrace
 *   Returns the most recent skip trace results for this property.
 *   Never consumes credits — read-only.
 *
 * POST /api/properties/[id]/skiptrace
 *   Runs a new skip trace (respects 90-day freshness unless ?force=true).
 *   Consumes one provider credit if data is stale.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { getLatestSkipTrace, runSkipTrace } from '@/lib/skiptrace/service'

export const dynamic   = 'force-dynamic'
export const maxDuration = 45

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const result = await getLatestSkipTrace(id)
  if (!result) return NextResponse.json({ result: null })
  return NextResponse.json({ result })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const url   = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'

  if (!process.env.REAPI_KEY) {
    return NextResponse.json({ error: 'NO_CREDENTIALS', message: 'REAPI_KEY is not configured.' }, { status: 422 })
  }

  // Fetch property for address + owner name
  const { data: prop } = await serviceClient
    .from('properties')
    .select('id, property_address, city, state, zip, owner_name')
    .eq('id', id)
    .maybeSingle()

  if (!prop?.property_address) {
    return NextResponse.json({ error: 'Property not found or missing address' }, { status: 404 })
  }

  // Resolve lead for activity logging
  const { data: lead } = await serviceClient
    .from('leads')
    .select('id')
    .eq('property_id', id)
    .maybeSingle()

  const nameParts = (prop.owner_name ?? '').trim().split(/\s+/)
  const input = {
    address:    prop.property_address,
    city:       prop.city  ?? '',
    state:      prop.state ?? 'FL',
    zip:        prop.zip   ?? '',
    first_name: nameParts[0] ?? null,
    last_name:  nameParts.slice(1).join(' ') || null,
  }

  try {
    const { stored, fromCache } = await runSkipTrace({
      propertyId: id,
      leadId:     lead?.id ?? null,
      input,
      userId:     user.id,
      userEmail:  user.email ?? 'system',
      force,
    })

    return NextResponse.json({ result: stored, from_cache: fromCache })
  } catch (err) {
    console.error('[SkipTrace] provider error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Skip trace failed' },
      { status: 502 }
    )
  }
}
