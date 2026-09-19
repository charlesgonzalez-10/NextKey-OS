/**
 * GET /api/properties/[id]/market
 *
 * Returns market context for a property's ZIP code.
 * Aggregates listing_intelligence rows we already hold — no external API call.
 *
 * Query params:
 *   force=true       — bypass 6h cache and recompute from current listings
 *   period=90        — trailing days to aggregate (default 90)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { propertyGraph }             from '@/lib/graph/propertyGraph'

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

  const sp     = req.nextUrl.searchParams
  const force  = sp.get('force') === 'true'

  try {
    const market = await propertyGraph.getMarketContext(id, { force })
    if (!market) return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    return NextResponse.json(market)
  } catch (err) {
    console.error('[GET /api/properties/[id]/market]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
