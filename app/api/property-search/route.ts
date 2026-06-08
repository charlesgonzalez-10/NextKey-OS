/**
 * GET /api/property-search?q=ADDRESS_OR_FOLIO&county=miami-dade
 *
 * Universal property lookup across Miami-Dade, Broward, and Palm Beach.
 * Routes to the right data source automatically based on detected county.
 *
 * Returns a PropertySearchResult with optional distress overlay from scraper_leads.
 *
 * Query params:
 *   q       - address, owner name, or folio number (required)
 *   county  - 'miami-dade' | 'broward' | 'palm-beach' (optional, auto-detected)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchProperty, detectCounty } from '@/lib/enrichment/property-search'
import type { County } from '@/lib/enrichment/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url    = new URL(req.url)
  const query  = url.searchParams.get('q')?.trim() ?? ''
  const county = (url.searchParams.get('county') ?? '') as County | ''

  if (!query) {
    return NextResponse.json({ error: 'q parameter is required' }, { status: 400 })
  }

  const resolvedCounty: County | undefined =
    county && county !== 'unknown' ? county : undefined

  try {
    const result = await searchProperty(query, resolvedCounty)

    if (!result) {
      return NextResponse.json({
        error:   'Property not found',
        query,
        county:  resolvedCounty ?? detectCounty(query),
        tip:     'Try including the city or zip code in the address',
      }, { status: 404 })
    }

    return NextResponse.json({ result, query })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[PropertySearch API]', msg)

    // Give a helpful error if REAPI key is missing
    if (msg.includes('REAPI_KEY')) {
      return NextResponse.json({
        error: 'Broward and Palm Beach lookup requires a RealEstateAPI.com API key. Add REAPI_KEY to your environment variables.',
        setup_required: true,
      }, { status: 503 })
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
