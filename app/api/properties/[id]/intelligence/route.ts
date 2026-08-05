/**
 * GET /api/properties/[id]/intelligence
 *
 * Returns the assembled PropertyGraph for a single property.
 *
 * This is the primary intelligence endpoint for:
 *   - NextKey OS workspace panels (listing intelligence, opportunity signals)
 *   - AI Copilot context injection
 *   - Acquisition Operating System property detail views
 *
 * Query params:
 *   listing=true          — include ListingIntelligence (MLS fetch if stale)
 *   signals=true          — include OpportunitySignals
 *   timeline=true         — include PropertyTimeline (merge-at-read)
 *   timeline_since=<ISO>  — filter timeline events after this date
 *   force=true            — bypass TTL cache; force a fresh DSOE fetch
 *
 * All consumers go through PropertyGraphService. No domain service is called
 * directly from this route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { propertyGraph }             from '@/lib/graph/propertyGraph'
import type { PropertyTimelineOptions } from '@/lib/graph/types'

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

  const sp = req.nextUrl.searchParams

  const includeListing          = sp.get('listing')  === 'true'
  const includeOpportunitySignals = sp.get('signals') === 'true'
  const includeTimeline         = sp.get('timeline') === 'true'
  const force                   = sp.get('force')    === 'true'

  const timelineOpts: PropertyTimelineOptions | undefined = includeTimeline
    ? {
        since:      sp.get('timeline_since') ?? undefined,
        visibility: 'all',
        limit:      100,
      }
    : undefined

  try {
    const graph = await propertyGraph.getPropertyGraph(id, {
      includeListing,
      includeOpportunitySignals,
      includeTimeline,
      timelineOpts,
      force,
    })

    if (!graph.summary) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    return NextResponse.json(graph)
  } catch (err) {
    console.error('[GET /api/properties/[id]/intelligence]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
