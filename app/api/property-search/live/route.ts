/**
 * GET /api/property-search/live
 *
 * Live property search powered by REAPI with 24h smart caching.
 * When REAPI is unavailable (402 wallet empty / 5xx), falls back to the
 * internal Supabase properties table so the UI always returns results.
 *
 * Cache behaviour:
 *   - Same query within 24h → return cached results instantly (0 API calls)
 *   - New query or expired cache → call REAPI, store results, return
 *   - REAPI 402/5xx → query internal DB, return db_fallback: true
 *
 * Query params: (all optional — at least one location required)
 *   search, county, city, zip, zone (JSON)
 *   lead_types, equity, value_min/max, beds_min/max, baths_min/max
 *   year_min/max, file_from/to, homestead, out_of_state
 *   page (default 1), limit (default 50, max 250)
 *   sort_by: file_date|equity_percentage|market_value  sort_dir: asc|desc
 *
 * Response:
 *   { properties, total, page, pages, cached, cache_age_seconds }
 *   { ..., db_fallback: true, warning: '...' }  ← when REAPI is down
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  buildCacheKey,
  executeREAPISearch,
  type SearchParams,
  type LiveProperty,
} from '@/lib/search/reapi-search'

export const dynamic = 'force-dynamic'

// Supabase service-role client for cache reads/writes (no auth needed server-side)
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const CACHE_TTL_HOURS = 24
const MAX_RECORDS     = 500  // max to fetch per search (cost control)

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

// ─── Internal DB fallback ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>

function equityTier(pct: number | null): 'High' | 'Medium' | 'Low' | 'None' {
  if (pct == null || pct <= 0) return 'None'
  if (pct >= 50) return 'High'
  if (pct >= 20) return 'Medium'
  return 'Low'
}

/** Map a properties table row → LiveProperty shape (same shape the UI renders) */
function dbRowToLiveProperty(row: DbRow): LiveProperty {
  const eqPct  = row.equity_percentage != null ? Number(row.equity_percentage) : null
  const mktVal = row.market_value       != null ? Number(row.market_value)      : null
  const debt   = row.known_debt         != null ? Number(row.known_debt)         : null
  const eqAmt  = row.equity_dollar_amount != null
    ? Number(row.equity_dollar_amount)
    : (mktVal != null && debt != null ? Math.max(0, mktVal - debt) : null)

  return {
    id:                row.id,
    reapi_id:          row.reapi_id ?? '',
    folio_number:      row.folio_number  ?? null,
    case_number:       row.case_number   ?? null,
    source:            'reapi',          // keep same shape — source field used for display
    data_source:       row.data_source   ?? 'Saved',

    property_address:  row.property_address ?? null,
    city:              row.city      ?? null,
    zip:               row.zip       ?? null,
    state:             row.state     ?? 'FL',
    county:            row.county    ?? '',
    latitude:          row.latitude  != null ? Number(row.latitude)  : null,
    longitude:         row.longitude != null ? Number(row.longitude) : null,
    subdivision_name:  row.subdivision_name ?? null,

    owner_name:        row.owner_name  ?? null,
    mortgagor:         row.mortgagor   ?? row.owner_name ?? null,
    entity_type:       row.entity_type ?? null,
    homestead:         row.homestead   ?? null,
    absentee_owner:    row.absentee_owner ?? null,

    beds:              row.beds        != null ? Number(row.beds)        : null,
    baths:             row.baths       != null ? Number(row.baths)       : null,
    living_area:       row.living_area != null ? Number(row.living_area) : null,
    lot_size:          row.lot_size    != null ? Number(row.lot_size)    : null,
    year_built:        row.year_built  != null ? Number(row.year_built)  : null,
    property_type:     row.property_type ?? null,

    market_value:         mktVal,
    assessed_value:       row.assessed_value  != null ? Number(row.assessed_value) : null,
    known_debt:           debt,
    equity_percentage:    eqPct,
    equity_dollar_amount: eqAmt,
    equity_tier:          (row.equity_tier as LiveProperty['equity_tier']) ?? equityTier(eqPct),
    free_clear:           row.free_clear   ?? false,
    high_equity:          row.high_equity  ?? (equityTier(eqPct) === 'High'),
    suggested_rent:       row.suggested_rent != null ? Number(row.suggested_rent) : null,

    is_pre_foreclosure:   row.is_pre_foreclosure ?? false,
    is_foreclosure:       row.is_foreclosure     ?? false,
    is_auction:           row.is_auction         ?? false,
    is_probate:           row.is_probate         ?? false,
    is_tax_deed:          row.is_tax_deed         ?? false,
    is_divorce:           row.is_divorce          ?? false,
    multiple_liens:       row.multiple_liens      ?? false,
    foreclosure_type:     row.foreclosure_type    ?? null,

    file_date:    row.file_date ? String(row.file_date).slice(0, 10) : null,
    plaintiff:    row.plaintiff   ?? null,
    lender_name:  row.lender_name ?? null,

    mls_status:        row.mls_status        ?? null,
    mls_listing_price: row.mls_listing_price != null ? Number(row.mls_listing_price) : null,
    mls_active:        row.mls_active        ?? false,

    // Leads join (if present from view)
    lead_id:        row.lead_id        ?? null,
    pipeline_stage: row.pipeline_stage ?? null,
    starred:        row.starred        ?? false,
    lead_score:     row.lead_score     ?? null,
    ai_score:       row.ai_score       ?? null,
    is_lead:        false,  // DB rows are existing leads — set true client-side if needed

    phone_1: row.phone_1 ?? null,
    phone_2: row.phone_2 ?? null,
    phone_3: row.phone_3 ?? null,

    _raw: row,
  }
}

/**
 * Query the internal properties table as a fallback when REAPI is unavailable.
 * Applies the same filters as the REAPI search where possible.
 */
async function queryInternalDB(
  search: SearchParams,
  supabase: SupabaseClient
): Promise<{ results: LiveProperty[]; total: number }> {
  // Use property_search view if it exists (includes lead join), otherwise properties
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = supabase
    .from('properties')
    .select(`
      *,
      leads!left(
        id,
        pipeline_stage,
        starred,
        lead_score,
        ai_score
      )
    `, { count: 'exact' })

  // ── Location filters ──
  if (search.county) {
    query = query.ilike('county', `%${search.county}%`)
  }
  if (search.city) {
    query = query.ilike('city', `%${search.city}%`)
  }
  if (search.zip) {
    query = query.eq('zip', search.zip)
  }
  if (search.search) {
    // Address or folio free-text
    query = query.or(
      `property_address.ilike.%${search.search}%,folio_number.ilike.%${search.search}%,owner_name.ilike.%${search.search}%`
    )
  }

  // ── Distress type filters ──
  const leadTypes = (search.lead_types ?? '').split(',').filter(Boolean)
  if (leadTypes.length > 0) {
    const orClauses: string[] = []
    if (leadTypes.includes('pre_foreclosure')) orClauses.push('is_pre_foreclosure.eq.true')
    if (leadTypes.includes('foreclosure'))     orClauses.push('is_foreclosure.eq.true')
    if (leadTypes.includes('auction'))         orClauses.push('is_auction.eq.true')
    if (orClauses.length > 0) {
      query = query.or(orClauses.join(','))
    }
  } else {
    // Default: only distress properties (mirror REAPI default of pre_foreclosure)
    query = query.or('is_pre_foreclosure.eq.true,is_foreclosure.eq.true,is_auction.eq.true')
  }

  // ── Equity filter ──
  if (search.equity) {
    const tiers = search.equity.split(',').filter(Boolean)
    if (tiers.length === 1) {
      query = query.eq('equity_tier', tiers[0])
    } else if (tiers.length > 1) {
      query = query.in('equity_tier', tiers)
    }
  }

  // ── Value range ──
  if (search.value_min) query = query.gte('market_value', Number(search.value_min))
  if (search.value_max) query = query.lte('market_value', Number(search.value_max))

  // ── Beds / baths ──
  if (search.beds_min)  query = query.gte('beds', Number(search.beds_min))
  if (search.beds_max)  query = query.lte('beds', Number(search.beds_max))
  if (search.baths_min) query = query.gte('baths', Number(search.baths_min))
  if (search.baths_max) query = query.lte('baths', Number(search.baths_max))

  // ── Year built ──
  if (search.year_min) query = query.gte('year_built', Number(search.year_min))
  if (search.year_max) query = query.lte('year_built', Number(search.year_max))

  // ── File date range ──
  if (search.file_from) query = query.gte('file_date', search.file_from)
  if (search.file_to)   query = query.lte('file_date', search.file_to)

  // ── Homestead ──
  if (search.homestead === 'true')  query = query.eq('homestead', true)
  if (search.homestead === 'false') query = query.eq('homestead', false)

  // ── Out-of-state owner ──
  if (search.out_of_state === 'true') query = query.eq('absentee_owner', true)

  // Limit result set (match REAPI cap)
  query = query.limit(500).order('file_date', { ascending: false, nullsFirst: false })

  const { data, error, count } = await query

  if (error) {
    console.error('[LiveSearch] DB fallback query error:', error.message)
    return { results: [], total: 0 }
  }

  // Flatten leads join
  const rows: DbRow[] = (data ?? []).map((row: DbRow) => {
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads
    return {
      ...row,
      leads:          undefined,
      lead_id:        lead?.id            ?? null,
      pipeline_stage: lead?.pipeline_stage ?? null,
      starred:        lead?.starred        ?? false,
      lead_score:     lead?.lead_score     ?? null,
      ai_score:       lead?.ai_score       ?? null,
    }
  })

  return {
    results: rows.map(dbRowToLiveProperty),
    total:   count ?? rows.length,
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams

  // Parse pagination / sort (excluded from cache key)
  const page    = Math.max(1, parseInt(p.get('page')  ?? '1',  10))
  const limit   = Math.min(parseInt(p.get('limit') ?? '50', 10), 250)
  const sortBy  = (['file_date','equity_percentage','market_value'].includes(p.get('sort_by') ?? '')
    ? p.get('sort_by')! : 'file_date') as SortKey
  const sortDir = p.get('sort_dir') === 'asc' ? 'asc' : 'desc'

  // Build search params (everything except page/sort)
  const search: SearchParams = {
    search:      p.get('search')      ?? undefined,
    county:      p.get('county')      ?? undefined,
    city:        p.get('city')        ?? undefined,
    zip:         p.get('zip')         ?? undefined,
    zone:        p.get('zone')        ?? undefined,
    lead_types:  p.get('lead_types')  ?? undefined,
    equity:      p.get('equity')      ?? undefined,
    value_min:   p.get('value_min')   ?? undefined,
    value_max:   p.get('value_max')   ?? undefined,
    beds_min:    p.get('beds_min')    ?? undefined,
    beds_max:    p.get('beds_max')    ?? undefined,
    baths_min:   p.get('baths_min')   ?? undefined,
    baths_max:   p.get('baths_max')   ?? undefined,
    year_min:    p.get('year_min')    ?? undefined,
    year_max:    p.get('year_max')    ?? undefined,
    file_from:   p.get('file_from')   ?? undefined,
    file_to:     p.get('file_to')     ?? undefined,
    homestead:   p.get('homestead')   ?? undefined,
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

  const supabase  = getSupabase()
  const cacheKey  = buildCacheKey(search)
  const now       = new Date()

  // ── Check cache ──────────────────────────────────────────────────────────
  const { data: cached } = await supabase
    .from('search_cache')
    .select('id, results, result_count, created_at, expires_at')
    .eq('search_hash', cacheKey)
    .gt('expires_at', now.toISOString())
    .maybeSingle()

  let allResults: LiveProperty[] = []
  let total = 0
  let wasCached = false
  let cacheAgeSeconds = 0
  let dbFallback = false
  let dbFallbackReason = ''

  if (cached) {
    // ── Cache hit ─────────────────────────────────────────────────────────
    allResults    = cached.results as LiveProperty[]
    total         = cached.result_count
    wasCached     = true
    cacheAgeSeconds = Math.floor((now.getTime() - new Date(cached.created_at).getTime()) / 1000)

    // Increment hit counter (fire-and-forget)
    supabase.from('search_cache')
      .update({ hit_count: supabase.rpc('coalesce', {}) })  // best-effort
      .eq('id', cached.id)
      .then(() => {})

    console.log(`[LiveSearch] Cache HIT — key=${cacheKey} age=${cacheAgeSeconds}s results=${allResults.length}`)
  } else {
    // ── Cache miss → call REAPI ───────────────────────────────────────────
    console.log(`[LiveSearch] Cache MISS — key=${cacheKey} querying REAPI...`)

    try {
      const result = await executeREAPISearch(search, MAX_RECORDS)
      allResults = result.results
      total      = result.total
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[LiveSearch] REAPI error:', msg)

      const isWalletError = msg.includes('402') || msg.includes('wallet') || msg.includes('balance')
      const isServerError = msg.includes('5') || msg.includes('timeout') || msg.includes('network')

      if (isWalletError || isServerError) {
        // ── Fallback to internal DB ──────────────────────────────────────
        console.log('[LiveSearch] Falling back to internal DB...')
        dbFallback = true
        dbFallbackReason = isWalletError
          ? 'REAPI wallet is empty — showing saved properties. Add funds at console.realestateapi.com/dashboard/billing'
          : 'REAPI temporarily unavailable — showing saved properties.'

        const dbResult = await queryInternalDB(search, supabase)
        allResults = dbResult.results
        total      = dbResult.total

        console.log(`[LiveSearch] DB fallback returned ${allResults.length} results`)
      } else {
        return NextResponse.json({ error: msg, properties: [], total: 0 }, { status: 500 })
      }
    }

    // Store in cache (fire-and-forget — don't block response)
    const expiresAt = new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000)
    supabase.from('search_cache').upsert({
      search_hash:  cacheKey,
      query_params: search,
      results:      allResults,
      result_count: total,
      created_at:   now.toISOString(),
      expires_at:   expiresAt.toISOString(),
      hit_count:    0,
    }, { onConflict: 'search_hash' }).then(() => {
      console.log(`[LiveSearch] Cached ${allResults.length} results (expires ${expiresAt.toISOString()})`)
    })
  }

  // ── Sort ───────────────────────────────────────────────────────────────
  const sorted = sortResults(allResults, sortBy, sortDir)

  // ── Paginate ───────────────────────────────────────────────────────────
  const pages   = Math.max(1, Math.ceil(sorted.length / limit))
  const start   = (page - 1) * limit
  const slice   = sorted.slice(start, start + limit)

  return NextResponse.json({
    properties:         slice,
    total:              sorted.length,
    total_in_market:    total,
    page,
    pages,
    limit,
    cached:             wasCached,
    cache_age_seconds:  cacheAgeSeconds,
    cache_key:          cacheKey,
    // Present when REAPI was unavailable and we served from internal DB instead
    ...(dbFallback ? {
      db_fallback: true,
      warning:     dbFallbackReason,
    } : {}),
  })
}
