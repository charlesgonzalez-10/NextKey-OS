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
import { buildCustomerContext } from '@/lib/billing/gatewayContext'
import {
  ensurePropertyRecord,
  recordPropertySearch,
  accumulateMarketData,
} from '@/lib/propertyService'

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
    const billing = buildCustomerContext(user.id)
    const result = await searchProperty(query, resolvedCounty, billing)

    if (!result) {
      return NextResponse.json({
        success:         false,
        results:         [],
        count:           0,
        cached:          false,
        searchSessionId: null,
        pagination:      null,
        error:           { code: 'not_found', message: 'Property not found. Try including the city or zip code.' },
      }, { status: 404 })
    }

    // Build intelligence record and record the search — fire-and-forget.
    // Never blocks the response. Never creates a Lead or CRM record.
    ensurePropertyRecord(result).then(propertyId => {
      if (propertyId) {
        recordPropertySearch(propertyId)
        accumulateMarketData({
          zip:          result.zip,
          city:         result.city,
          county:       result.county,
          market_value: result.market_value,
          propertyId,
          source:       result.source,
        })
      }
    }).catch(() => {})

    return NextResponse.json({
      success:         true,
      results:         [result],
      count:           1,
      cached:          false,
      searchSessionId: null,
      pagination:      null,
      error:           null,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[PropertySearch API]', msg)

    const errorMsg = msg.includes('REAPI_KEY')
      ? 'Broward and Palm Beach lookup requires a RealEstateAPI.com API key.'
      : msg

    return NextResponse.json({
      success:         false,
      results:         [],
      count:           0,
      cached:          false,
      searchSessionId: null,
      pagination:      null,
      error:           { code: 'search_error', message: errorMsg },
    }, { status: msg.includes('REAPI_KEY') ? 503 : 500 })
  }
}
