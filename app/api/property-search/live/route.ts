/**
 * GET /api/property-search/live
 *
 * Live property search powered by REAPI, routed through ProviderGateway.
 *
 * Billing invariants:
 *   - Fresh cache (< 24h) → 0 vendor cost, 0 credits charged
 *   - Cache miss → 1 credit per search action (page 1), 5¢ vendor cost per page
 *   - Partial result → pages already fetched are returned; block code included
 *   - Pool: customer_shared (no spillover to owner_reserved)
 *   - Budget blocks → 402
 *   - Provider/feature disabled → 503
 *   - Provider error → 502
 *
 * Query params: (all optional — at least one location required)
 *   search, county, city, zip, zone (JSON)
 *   lead_types, equity, value_min/max, beds_min/max, baths_min/max
 *   year_min/max, file_from/to, homestead, out_of_state
 *   page (default 1), limit (default 50, max 250)
 *   sort_by: file_date|equity_percentage|market_value  sort_dir: asc|desc
 *   force (skip cache — for testing, admin use)
 *
 * Response:
 *   { properties, total, total_in_market, page, pages, cached, cache_age_seconds, outcome }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  buildCacheKey,
  executeGatewaySearch,
  type SearchParams,
  type LiveProperty,
} from '@/lib/search/reapi-search'
import { buildCustomerContext } from '@/lib/billing/gatewayContext'

export const dynamic = 'force-dynamic'

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const CACHE_TTL_HOURS = 24

// ─── Sort helpers ─────────────────────────────────────────────────────────────

type SortKey = 'file_date' | 'equity_percentage' | 'market_value'

function sortResults(
  results: LiveProperty[],
  sortBy:  SortKey,
  sortDir: 'asc' | 'desc'
): LiveProperty[] {
  return [...results].sort((a, b) => {
    let av: number, bv: number
    if (sortBy === 'file_date') {
      av = a.file_date ? new Date(a.file_date).getTime() : 0
      bv = b.file_date ? new Date(b.file_date).getTime() : 0
    } else if (sortBy === 'equity_percentage') {
      av = a.equity_percentage ?? -1
      bv = b.equity_percentage ?? -1
    } else {
      av = a.market_value ?? 0
      bv = b.market_value ?? 0
    }
    return sortDir === 'asc' ? av - bv : bv - av
  })
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authClient = await createClient()
  const { data: { user }, error: authError } = await authClient.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const p = req.nextUrl.searchParams

  // Parse pagination / sort (excluded from cache key)
  const page    = Math.max(1, parseInt(p.get('page')  ?? '1',  10))
  const limit   = Math.min(parseInt(p.get('limit') ?? '50', 10), 250)
  const sortBy  = (['file_date','equity_percentage','market_value'].includes(p.get('sort_by') ?? '')
    ? p.get('sort_by')! : 'file_date') as SortKey
  const sortDir = p.get('sort_dir') === 'asc' ? 'asc' : 'desc'
  const force   = p.get('force') === 'true'

  // Build search params (everything except page/sort)
  const search: SearchParams = {
    search:      p.get('search')       ?? undefined,
    county:      p.get('county')       ?? undefined,
    city:        p.get('city')         ?? undefined,
    zip:         p.get('zip')          ?? undefined,
    zone:        p.get('zone')         ?? undefined,
    lead_types:  p.get('lead_types')   ?? undefined,
    equity:      p.get('equity')       ?? undefined,
    value_min:   p.get('value_min')    ?? undefined,
    value_max:   p.get('value_max')    ?? undefined,
    beds_min:    p.get('beds_min')     ?? undefined,
    beds_max:    p.get('beds_max')     ?? undefined,
    baths_min:   p.get('baths_min')    ?? undefined,
    baths_max:   p.get('baths_max')    ?? undefined,
    year_min:    p.get('year_min')     ?? undefined,
    year_max:    p.get('year_max')     ?? undefined,
    file_from:   p.get('file_from')    ?? undefined,
    file_to:     p.get('file_to')      ?? undefined,
    homestead:   p.get('homestead')    ?? undefined,
    out_of_state: p.get('out_of_state') ?? undefined,
  }

  // Require at least one meaningful filter
  const hasFilter = Object.values(search).some(v => v !== undefined && v !== '')
  if (!hasFilter) {
    return NextResponse.json(
      { error: 'At least one search filter is required (county, city, zip, address, or zone)' },
      { status: 400 }
    )
  }

  const supabase = getServiceSupabase()
  const cacheKey = buildCacheKey(search)
  const now      = new Date()

  // ── Check cache (skip if force=true) ────────────────────────────────────
  if (!force) {
    const { data: cached } = await supabase
      .from('search_cache')
      .select('id, results, result_count, created_at, expires_at')
      .eq('search_hash', cacheKey)
      .gt('expires_at', now.toISOString())
      .maybeSingle()

    if (cached) {
      const allResults    = cached.results as LiveProperty[]
      const cacheAgeSecs  = Math.floor((now.getTime() - new Date(cached.created_at).getTime()) / 1000)
      const sorted        = sortResults(allResults, sortBy, sortDir)
      const pages         = Math.max(1, Math.ceil(sorted.length / limit))
      const slice         = sorted.slice((page - 1) * limit, page * limit)

      console.log(`[LiveSearch] Cache HIT — user=${user.id} key=${cacheKey} age=${cacheAgeSecs}s`)

      return NextResponse.json({
        properties:        slice,
        total:             sorted.length,
        total_in_market:   cached.result_count,
        page,
        pages,
        limit,
        cached:            true,
        cache_age_seconds: cacheAgeSecs,
        cache_key:         cacheKey,
        outcome:           'cache_hit',
      })
    }
  }

  // ── Cache miss — call REAPI through gateway ──────────────────────────────
  const billing          = buildCustomerContext(user.id)
  const searchSessionId  = `${cacheKey.slice(0, 16)}-${Math.floor(Date.now() / 60_000)}`

  console.log(`[LiveSearch] Cache MISS — user=${user.id} key=${cacheKey} session=${searchSessionId}`)

  const gatewayResult = await executeGatewaySearch(search, billing, searchSessionId)

  // ── Map gateway outcome to HTTP ──────────────────────────────────────────
  if (gatewayResult.outcome === 'credit_insufficient') {
    return NextResponse.json({
      error:       'Insufficient credits to perform this search.',
      outcome:     gatewayResult.outcome,
      safe_message: (gatewayResult as { safe_message?: string }).safe_message,
    }, { status: 402 })
  }

  if (
    gatewayResult.outcome === 'customer_pool_exhausted' ||
    gatewayResult.outcome === 'account_capacity_limit' ||
    gatewayResult.outcome === 'global_budget_exhausted'
  ) {
    return NextResponse.json({
      error:       'Search budget limit reached. Please try again later.',
      outcome:     gatewayResult.outcome,
      safe_message: (gatewayResult as { safe_message?: string }).safe_message,
    }, { status: 402 })
  }

  if (
    gatewayResult.outcome === 'provider_disabled' ||
    gatewayResult.outcome === 'feature_disabled' ||
    gatewayResult.outcome === 'authorization_unavailable'
  ) {
    return NextResponse.json({
      error:       'Live search is temporarily unavailable.',
      outcome:     gatewayResult.outcome,
      safe_message: (gatewayResult as { safe_message?: string }).safe_message,
    }, { status: 503 })
  }

  if (gatewayResult.outcome === 'provider_failed') {
    return NextResponse.json({
      error:       'Provider temporarily unavailable.',
      outcome:     gatewayResult.outcome,
      safe_message: (gatewayResult as { safe_message?: string }).safe_message,
    }, { status: 502 })
  }

  // success or partial_result — both union members have properties/total/pages_fetched.
  // All error outcomes were returned above; this guard is a safety net for TS.
  if (!('properties' in gatewayResult)) {
    return NextResponse.json({ error: 'Search unavailable' }, { status: 503 })
  }

  const allResults = gatewayResult.properties
  const total      = gatewayResult.total
  const isPartial  = gatewayResult.outcome === 'partial_result'

  // ── Store in cache (fire-and-forget; don't cache partial results) ────────
  if (!isPartial && allResults.length > 0) {
    const expiresAt = new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000)
    supabase.from('search_cache').upsert({
      search_hash:  cacheKey,
      query_params: search,
      results:      allResults,
      result_count: total,
      created_at:   now.toISOString(),
      expires_at:   expiresAt.toISOString(),
      hit_count:    0,
    }, { onConflict: 'search_hash' }).then(({ error }) => {
      if (error) console.error('[LiveSearch] Cache write error:', error.message)
      else console.log(`[LiveSearch] Cached ${allResults.length} results (expires ${expiresAt.toISOString()})`)
    })
  }

  // ── Sort and paginate ────────────────────────────────────────────────────
  const sorted = sortResults(allResults, sortBy, sortDir)
  const pages  = Math.max(1, Math.ceil(sorted.length / limit))
  const slice  = sorted.slice((page - 1) * limit, page * limit)

  return NextResponse.json({
    properties:       slice,
    total:            sorted.length,
    total_in_market:  total,
    page,
    pages,
    limit,
    cached:           false,
    cache_age_seconds: 0,
    cache_key:        cacheKey,
    outcome:          gatewayResult.outcome,
    pages_fetched:    gatewayResult.pages_fetched,
    ...(isPartial ? {
      partial:       true,
      partial_reason: (gatewayResult as { error_code?: string }).error_code,
    } : {}),
  })
}
