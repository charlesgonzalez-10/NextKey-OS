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
 * Standard response envelope:
 *   { success, results, count, cached, searchSessionId, pagination, error }
 *   On success: error is null; on failure: results is [], error has { code, message }.
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

// ─── Response helpers ─────────────────────────────────────────────────────────

function ok(
  results: LiveProperty[],
  count: number,
  cached: boolean,
  searchSessionId: string | null,
  pagination: { page: number; pageSize: number; totalPages: number } | null,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json({
    success:         true,
    results,
    count,
    cached,
    searchSessionId,
    pagination,
    error:           null,
    ...extra,
  })
}

function fail(
  code: string,
  message: string,
  status: number,
) {
  return NextResponse.json({
    success:         false,
    results:         [],
    count:           0,
    cached:          false,
    searchSessionId: null,
    pagination:      null,
    error:           { code, message },
  }, { status })
}

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
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authClient = await createClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()

    if (authError || !user) {
      return fail('unauthorized', 'Unauthorized', 401)
    }

    const p = req.nextUrl.searchParams

    // Parse pagination / sort (excluded from cache key)
    const page       = Math.max(1, parseInt(p.get('page')  ?? '1',  10))
    const limit      = Math.min(parseInt(p.get('limit') ?? '50', 10), 250)
    const sortBy     = (['file_date','equity_percentage','market_value'].includes(p.get('sort_by') ?? '')
      ? p.get('sort_by')! : 'file_date') as SortKey
    const sortDir    = p.get('sort_dir') === 'asc' ? 'asc' : 'desc'
    const force      = p.get('force') === 'true'
    // refresh_gen: 0 = ordinary request/retry (idempotent); 1+ = explicit "Refresh Results"
    // (new billing_request_id, skip cache). Clamped to 0-100 to prevent runaway spend.
    const refreshGen = Math.min(100, Math.max(0, parseInt(p.get('refresh_gen') ?? '0', 10) || 0))

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
      return fail(
        'missing_filter',
        'At least one search filter is required (county, city, zip, address, or zone)',
        400
      )
    }

    const supabase = getServiceSupabase()
    const cacheKey = buildCacheKey(search)
    const now      = new Date()

    // ── Check cache (skip if force=true or explicit refresh) ─────────────
    // refresh_gen > 0 means the user explicitly requested fresh data.
    // Skipping cache here ensures they get a live provider call and a new
    // billing_request_id — even if a stale entry exists.
    if (!force && refreshGen === 0) {
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
        const totalPages    = Math.max(1, Math.ceil(sorted.length / limit))
        const slice         = sorted.slice((page - 1) * limit, page * limit)
        const sessionId     = `${cacheKey.slice(0, 16)}-cache`

        console.log(`[LiveSearch] Cache HIT — user=${user.id} key=${cacheKey} age=${cacheAgeSecs}s results=${allResults.length}`)

        return ok(slice, sorted.length, true, sessionId, { page, pageSize: limit, totalPages }, {
          total_in_market:   cached.result_count,
          cache_age_seconds: cacheAgeSecs,
          cache_key:         cacheKey,
          outcome:           'cache_hit',
        })
      }
    }

    // ── Cache miss — call REAPI through gateway ────────────────────────────
    // logicalSearchId = cacheKey: stable per (user, search params, UTC day).
    // billing_request_id inside executeGatewaySearch is derived from this — same
    // user + same params + same page + same day always produce the same request_id,
    // preventing double-charges on retried requests.
    // attemptId = random UUID per HTTP invocation for logging/tracing only;
    // it is never used as a billing key.
    const billing         = buildCustomerContext(user.id)
    const { randomUUID }  = await import('crypto')
    const logicalSearchId = cacheKey
    const attemptId       = randomUUID()

    console.log(
      `[LiveSearch] Cache MISS — user=${user.id} key=${cacheKey} ` +
      `attempt=${attemptId} refresh_gen=${refreshGen}`
    )

    const gatewayResult = await executeGatewaySearch(search, billing, logicalSearchId, undefined, attemptId, refreshGen)

    // ── Map gateway outcome to HTTP ────────────────────────────────────────
    if (gatewayResult.outcome === 'credit_insufficient') {
      return fail('credit_insufficient', 'Insufficient credits to perform this search.', 402)
    }

    if (
      gatewayResult.outcome === 'customer_pool_exhausted' ||
      gatewayResult.outcome === 'account_capacity_limit' ||
      gatewayResult.outcome === 'global_budget_exhausted'
    ) {
      return fail('budget_exhausted', 'Search budget limit reached. Please try again later.', 402)
    }

    if (
      gatewayResult.outcome === 'provider_disabled' ||
      gatewayResult.outcome === 'feature_disabled' ||
      gatewayResult.outcome === 'authorization_unavailable'
    ) {
      // Surface safe_message when available (e.g. REAPI wallet insufficient error)
      const safeMsg = ('safe_message' in gatewayResult && gatewayResult.safe_message)
        ? gatewayResult.safe_message
        : 'Live search is temporarily unavailable.'
      return fail('provider_unavailable', safeMsg, 503)
    }

    if (gatewayResult.outcome === 'provider_failed') {
      return fail('provider_error', 'Provider temporarily unavailable.', 502)
    }

    // success or partial_result
    if (!('properties' in gatewayResult)) {
      return fail('search_unavailable', 'Search unavailable', 503)
    }

    const allResults = gatewayResult.properties
    const total      = gatewayResult.total
    const isPartial  = gatewayResult.outcome === 'partial_result'

    // ── Store in cache (fire-and-forget; don't cache partial results) ──────
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

    // ── Sort and paginate ────────────────────────────────────────────────
    const sorted     = sortResults(allResults, sortBy, sortDir)
    const totalPages = Math.max(1, Math.ceil(sorted.length / limit))
    const slice      = sorted.slice((page - 1) * limit, page * limit)

    console.log(`[LiveSearch] Search complete — user=${user.id} outcome=${gatewayResult.outcome} results=${sorted.length} pages=${totalPages} partial=${isPartial}`)

    return ok(slice, sorted.length, false, attemptId, { page, pageSize: limit, totalPages }, {
      total_in_market: total,
      cache_key:       cacheKey,
      outcome:         gatewayResult.outcome,
      pages_fetched:   gatewayResult.pages_fetched,
      ...(isPartial ? {
        partial:        true,
        partial_reason: (gatewayResult as { error_code?: string }).error_code,
      } : {}),
    })

  } catch (err) {
    const msg   = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack  : undefined
    console.error('[LiveSearch] UNHANDLED EXCEPTION — type:', err instanceof Error ? err.constructor.name : typeof err)
    console.error('[LiveSearch] UNHANDLED EXCEPTION — message:', msg)
    if (stack) console.error('[LiveSearch] UNHANDLED EXCEPTION — stack:', stack)
    return fail('server_error', 'Search temporarily unavailable. Please try again.', 500)
  }
}
