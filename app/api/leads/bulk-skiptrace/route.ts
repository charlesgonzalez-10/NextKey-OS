/**
 * POST /api/leads/bulk-skiptrace
 * Body: { propertyIds: string[], force?: boolean }
 *
 * Runs skip trace for each property sequentially, respecting the 90-day
 * freshness window (already-fresh properties are counted as skipped).
 * Returns a summary with credit count so the caller can show cost before confirming.
 *
 * Query params:
 *   ?preview=true — dry-run: returns how many would be fresh vs stale (no API calls)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { bulkSkipTrace } from '@/lib/skiptrace/service'
import { getModuleFreshness } from '@/lib/propertyService'
import { buildCustomerContext } from '@/lib/billing/gatewayContext'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.REAPI_KEY) {
    return NextResponse.json({ error: 'NO_CREDENTIALS', message: 'REAPI_KEY is not configured.' }, { status: 422 })
  }

  const url     = new URL(req.url)
  const preview = url.searchParams.get('preview') === 'true'

  let body: { propertyIds?: string[]; force?: boolean }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { propertyIds = [], force = false } = body

  if (!propertyIds.length) {
    return NextResponse.json({ error: 'propertyIds is required' }, { status: 400 })
  }

  // ── Preview mode: count fresh vs stale without running any traces ──────────
  if (preview) {
    const freshness = await Promise.all(
      propertyIds.map(id => getModuleFreshness(id, 'skiptrace').catch(() => null))
    )
    const stale = freshness.filter(f => f && !f.isFresh).length
    const fresh = freshness.filter(f => f && f.isFresh).length

    // Validate each property has an address
    const { data: props } = await serviceClient
      .from('properties')
      .select('id, property_address')
      .in('id', propertyIds)

    const addressless = (props ?? []).filter(p => !p.property_address).length

    return NextResponse.json({
      preview:       true,
      total:         propertyIds.length,
      would_trace:   stale - addressless,
      already_fresh: fresh,
      no_address:    addressless,
      estimated_credits: stale - addressless,
    })
  }

  // ── Execute traces ─────────────────────────────────────────────────────────
  const billing = buildCustomerContext(user.id)
  const summary = await bulkSkipTrace({
    propertyIds,
    userId:    user.id,
    userEmail: user.email ?? 'system',
    force,
    billing,
  })

  return NextResponse.json(summary)
}
