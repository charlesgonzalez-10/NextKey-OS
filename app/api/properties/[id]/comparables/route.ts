/**
 * GET  /api/properties/[id]/comparables
 * POST /api/properties/[id]/comparables
 *
 * GET: Returns cached comparable intelligence for a property.
 *   Query params:
 *     status=active|pending|sold|rental  — filter by comp status (returns all if omitted)
 *     refresh=true                       — bypass TTL and re-fetch from REAPI
 *     radius=0.5                         — search radius in miles (default 0.5, max 2.0)
 *
 * POST: Trigger a manual refresh of the comp set.
 *   Body: { force?: boolean, radius?: number, max_comps?: number, sold_within_days?: number }
 *
 * All reads go through propertyGraph → propertyService → comparables.ts.
 * No provider is called directly from this route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { propertyGraph }             from '@/lib/graph/propertyGraph'
import { buildCustomerContext }      from '@/lib/billing/gatewayContext'
import type { CompStatus }           from '@/lib/graph/types'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing property id' }, { status: 400 })

  const sp      = req.nextUrl.searchParams
  const status  = sp.get('status') as CompStatus | null
  const force   = sp.get('refresh') === 'true'
  const radius  = parseFloat(sp.get('radius') ?? '0.5') || 0.5

  try {
    const comps = await propertyGraph.getComparableIntelligence(id, {
      force,
      radiusMiles: radius,
      billing:     buildCustomerContext(user.id),
    })
    if (!comps) return NextResponse.json({ error: 'Property not found' }, { status: 404 })

    // Apply status filter if requested
    const filtered = status
      ? {
          ...comps,
          active:  status === 'active'  ? comps.active  : [],
          pending: status === 'pending' ? comps.pending : [],
          sold:    status === 'sold'    ? comps.sold    : [],
          rental:  status === 'rental'  ? comps.rental  : [],
        }
      : comps

    return NextResponse.json(filtered)
  } catch (err) {
    console.error('[GET /api/properties/[id]/comparables]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing property id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))

  try {
    const comps = await propertyGraph.getComparableIntelligence(id, {
      force:          true,
      radiusMiles:    body.radius           ?? 0.5,
      maxComps:       body.max_comps        ?? 10,
      soldWithinDays: body.sold_within_days ?? 180,
      billing:        buildCustomerContext(user.id),
    })

    if (!comps) return NextResponse.json({ error: 'Property not found' }, { status: 404 })

    return NextResponse.json({
      ok:          true,
      sampleSize:  comps.summary.sampleSize,
      confidence:  comps.summary.confidence,
      fromCache:   comps.fromCache,
    })
  } catch (err) {
    console.error('[POST /api/properties/[id]/comparables]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
