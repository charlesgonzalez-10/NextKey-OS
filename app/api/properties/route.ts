/**
 * GET /api/properties
 *
 * Unified property search API — queries the properties table (unified property
 * intelligence database) with an optional LEFT JOIN to leads for workflow fields.
 *
 * This is the canonical property search endpoint. The old /api/scraper/leads
 * route is kept as an alias for backward compat.
 *
 * Query params:
 *   page, limit, sort_by, sort_dir
 *   search, county, city, zip, subdivision, entity_type, property_type, data_source
 *   homestead, vacant, out_of_state, pool
 *   beds_min, beds_max, baths_min, baths_max, sqft_min, sqft_max
 *   year_min, year_max
 *   equity, equity_min, equity_max, equity_amount_min, equity_amount_max
 *   value_min, value_max, free_clear
 *   debt_min, debt_max
 *   file_from, file_to, days_min, days_max, plaintiff
 *   pipeline_stage, starred, has_phone, multiple_liens, in_pipeline, ai_score_min
 *   is_lead — filter to only properties that are in leads ('true' | 'false')
 *   lead_types — comma-separated OR list of lead type keys (pre_foreclosure, auction,
 *                multiple_liens, absentee, vacant, high_equity, medium_equity,
 *                low_equity, free_clear, llc_corp, trust, individual, owner_occupied)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

// serviceClient is a lazy Proxy — no createClient call at module eval time
const supabase = serviceClient

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const p = req.nextUrl.searchParams

  const page  = Math.max(1, parseInt(p.get('page')  || '1', 10))
  const limit = Math.min(parseInt(p.get('limit') || '100', 10), 500)

  // Filters
  const county        = p.get('county')        || ''
  const search        = p.get('search')        || ''
  const equity        = p.get('equity')        || ''
  const city          = p.get('city')          || ''
  const zip           = p.get('zip')           || ''
  const entity_type   = p.get('entity_type')   || ''
  const property_type = p.get('property_type') || ''
  const data_source   = p.get('data_source')   || ''
  const homestead     = p.get('homestead')
  const vacant        = p.get('vacant')
  const pipeline_stage   = p.get('pipeline_stage') || ''
  const starred          = p.get('starred')
  const has_phone        = p.get('has_phone')
  const multiple_liens   = p.get('multiple_liens')
  const is_lead          = p.get('is_lead')     // filter to only leads or non-leads
  const in_pipeline      = p.get('in_pipeline') // only properties with a pipeline stage set
  const subdivision      = p.get('subdivision') || ''
  const plaintiff        = p.get('plaintiff')   || ''
  const free_clear       = p.get('free_clear')
  const out_of_state     = p.get('out_of_state')
  const pool             = p.get('pool')
  const ai_score_min     = p.get('ai_score_min') ? parseInt(p.get('ai_score_min')!, 10) : null
  const lead_types_raw   = p.get('lead_types') || ''
  const lead_types       = lead_types_raw ? lead_types_raw.split(',').filter(Boolean) : []
  const imported              = p.get('imported')            // 'true' = has imported_to_contact
  const blocked               = p.get('blocked')             // 'true' = blocked=true
  const record_type           = p.get('record_type') || ''   // tab filter: lp | probate | auction | tax_deed | divorce
  const acquisition_pipeline  = p.get('acquisition_pipeline') || ''

  const beds_min   = p.get('beds_min')   ? parseInt(p.get('beds_min')!, 10)   : null
  const beds_max   = p.get('beds_max')   ? parseInt(p.get('beds_max')!, 10)   : null
  const baths_min  = p.get('baths_min')  ? parseFloat(p.get('baths_min')!)    : null
  const baths_max  = p.get('baths_max')  ? parseFloat(p.get('baths_max')!)    : null
  const sqft_min   = p.get('sqft_min')   ? parseInt(p.get('sqft_min')!, 10)   : null
  const sqft_max   = p.get('sqft_max')   ? parseInt(p.get('sqft_max')!, 10)   : null
  const year_min   = p.get('year_min')   ? parseInt(p.get('year_min')!, 10)   : null
  const year_max   = p.get('year_max')   ? parseInt(p.get('year_max')!, 10)   : null
  const equity_min        = p.get('equity_min')        ? parseFloat(p.get('equity_min')!)        : null
  const equity_max        = p.get('equity_max')        ? parseFloat(p.get('equity_max')!)        : null
  const equity_amount_min = p.get('equity_amount_min') ? parseInt(p.get('equity_amount_min')!, 10) : null
  const equity_amount_max = p.get('equity_amount_max') ? parseInt(p.get('equity_amount_max')!, 10) : null
  const value_min         = p.get('value_min')         ? parseInt(p.get('value_min')!, 10)       : null
  const value_max         = p.get('value_max')         ? parseInt(p.get('value_max')!, 10)       : null
  const debt_min   = p.get('debt_min')   ? parseInt(p.get('debt_min')!, 10)   : null
  const debt_max   = p.get('debt_max')   ? parseInt(p.get('debt_max')!, 10)   : null
  const file_from  = p.get('file_from')  || ''
  const file_to    = p.get('file_to')    || ''
  const days_min   = p.get('days_min')   ? parseInt(p.get('days_min')!,  10) : null
  const days_max   = p.get('days_max')   ? parseInt(p.get('days_max')!,  10) : null

  // Sort
  const SORT_WHITELIST = [
    'file_date', 'equity_percentage', 'market_value',
    'lead_score', 'created_at', 'assessed_value', 'beds',
  ] as const
  type SortCol = typeof SORT_WHITELIST[number]
  const rawSort  = p.get('sort_by') || 'file_date'
  const sort_by  = (SORT_WHITELIST.includes(rawSort as SortCol) ? rawSort : 'file_date') as SortCol
  const sort_dir = p.get('sort_dir') === 'asc'

  // ── Build properties query ─────────────────────────────────────────────────
  let query = supabase
    .from('properties')
    .select(`
      id, created_at, updated_at, source, county, data_source,
      case_number, file_date, plaintiff, mortgagor, foreclosure_amount,
      lender_name, foreclosure_type, multiple_liens,
      is_pre_foreclosure, is_foreclosure, is_auction, is_tax_lien,
      is_probate, is_tax_deed, is_divorce,
      free_clear, high_equity,
      surplus_funds_amount, last_sale_date,
      folio_number, owner_name, property_address, city, zip,
      owner_state, owner_zip, owner_city, mailing_address, auction_date,
      unit_number, num_units,
      beds, baths, year_built, living_area, lot_size,
      assessed_value, market_value, equity_percentage,
      equity_dollar_amount, equity_tier, known_debt,
      homestead, vacant, entity_type, property_type,
      phone_1, phone_2, phone_3, phone_4, phone_5,
      subdivision_name, enriched_at, enrichment_src,
      suggested_rent, latitude, longitude
    `, { count: 'exact' })
    .order(sort_by,      { ascending: sort_dir })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  // ── Apply filters ──────────────────────────────────────────────────────────
  if (county)        query = query.eq('county', county)
  if (data_source)   query = query.eq('data_source', data_source)
  if (entity_type)   query = query.ilike('entity_type', `%${entity_type}%`)
  if (property_type) query = query.ilike('property_type', `%${property_type}%`)
  if (city)          query = query.ilike('city', `%${city}%`)
  if (zip)           query = query.eq('zip', zip)
  if (subdivision)   query = query.ilike('subdivision_name', `%${subdivision}%`)
  if (plaintiff)     query = query.ilike('plaintiff', `%${plaintiff}%`)
  if (homestead === 'true')  query = query.eq('homestead', true)
  if (homestead === 'false') query = query.eq('homestead', false)
  if (vacant === 'true')     query = query.eq('vacant', true)
  if (vacant === 'false')    query = query.eq('vacant', false)
  if (pool === 'true')       query = query.eq('pool', true)
  if (free_clear === 'true') query = query.eq('free_clear', true)
  if (out_of_state === 'true') {
    query = query.not('owner_state', 'is', null)
    query = query.neq('owner_state', 'FL')
    query = query.neq('owner_state', '')
  }
  if (beds_min   !== null) query = query.gte('beds', beds_min)
  if (beds_max   !== null) query = query.lte('beds', beds_max)
  if (baths_min  !== null) query = query.gte('baths', baths_min)
  if (baths_max  !== null) query = query.lte('baths', baths_max)
  if (sqft_min   !== null) query = query.gte('living_area', sqft_min)
  if (sqft_max   !== null) query = query.lte('living_area', sqft_max)
  if (year_min   !== null) query = query.gte('year_built', year_min)
  if (year_max   !== null) query = query.lte('year_built', year_max)
  if (equity_min        !== null) query = query.gte('equity_percentage', equity_min)
  if (equity_max        !== null) query = query.lte('equity_percentage', equity_max)
  if (equity_amount_min !== null) query = query.gte('equity_dollar_amount', equity_amount_min)
  if (equity_amount_max !== null) query = query.lte('equity_dollar_amount', equity_amount_max)
  if (debt_min   !== null) query = query.gte('known_debt', debt_min)
  if (debt_max   !== null) query = query.lte('known_debt', debt_max)
  if (file_from)           query = query.gte('file_date', file_from)
  if (file_to)             query = query.lte('file_date', file_to)
  if (multiple_liens === 'true') query = query.eq('multiple_liens', true)
  if (has_phone  === 'true') query = query.not('phone_1', 'is', null)

  // Equity tier (scraper stores 'None' when not computed — treat as null)
  if (equity === 'High' || equity === 'Medium' || equity === 'Low') {
    query = query.eq('equity_tier', equity)
  } else if (equity === 'None') {
    query = query.or('equity_tier.eq.None,equity_tier.is.null')
  }

  // Value range: check market_value first, fall back to assessed_value
  if (value_min !== null) {
    query = query.or(`market_value.gte.${value_min},and(market_value.is.null,assessed_value.gte.${value_min})`)
  }
  if (value_max !== null) {
    query = query.or(`market_value.lte.${value_max},and(market_value.is.null,assessed_value.lte.${value_max})`)
  }

  // Days since file_date → convert to date range
  if (days_min !== null) {
    const d = new Date(); d.setDate(d.getDate() - days_min)
    query = query.lte('file_date', d.toISOString().slice(0, 10))
  }
  if (days_max !== null) {
    const d = new Date(); d.setDate(d.getDate() - days_max)
    query = query.gte('file_date', d.toISOString().slice(0, 10))
  }

  // Text search across key fields
  if (search) {
    query = query.or(
      `owner_name.ilike.%${search}%,property_address.ilike.%${search}%,` +
      `case_number.ilike.%${search}%,folio_number.ilike.%${search}%,` +
      `plaintiff.ilike.%${search}%,mortgagor.ilike.%${search}%,` +
      `phone_1.ilike.%${search}%,phone_2.ilike.%${search}%,` +
      `subdivision_name.ilike.%${search}%,city.ilike.%${search}%`
    )
  }

  // ── Record type tab filter ────────────────────────────────────────────────
  if (record_type === 'lp')       query = query.eq('is_pre_foreclosure', true)
  if (record_type === 'probate')  query = query.eq('is_probate', true)
  if (record_type === 'auction')  query = query.eq('is_auction', true)
  if (record_type === 'tax_deed') query = query.eq('is_tax_deed', true)
  if (record_type === 'divorce')  query = query.eq('is_divorce', true)

  // ── Lead type OR filter ────────────────────────────────────────────────────
  // Each lead type maps to one or more PostgREST filter expressions.
  // All selected types are OR'd together (match ANY selected type).
  const LEAD_TYPE_FILTER_MAP: Record<string, string[]> = {
    pre_foreclosure:  ['is_pre_foreclosure.eq.true'],
    auction:          ['is_auction.eq.true'],
    multiple_liens:   ['multiple_liens.eq.true'],
    absentee:         ['homestead.eq.false'],
    owner_occupied:   ['homestead.eq.true'],
    vacant:           ['vacant.eq.true'],
    high_equity:      ['equity_tier.eq.High'],
    medium_equity:    ['equity_tier.eq.Medium'],
    low_equity:       ['equity_tier.eq.Low'],
    free_clear:       ['free_clear.eq.true'],
    llc_corp:         ['entity_type.ilike.%LLC%', 'entity_type.ilike.%Corp%', 'entity_type.ilike.%Inc%'],
    trust:            ['entity_type.ilike.%Trust%', 'entity_type.ilike.%Estate%'],
    individual:       ['entity_type.eq.Individual'],
  }
  if (lead_types.length > 0) {
    const orClauses = lead_types.flatMap(t => LEAD_TYPE_FILTER_MAP[t] || [])
    if (orClauses.length > 0) {
      query = query.or(orClauses.join(','))
    }
  }

  const { data: properties, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const propIds = (properties ?? []).map(pr => pr.id)

  // ── Fetch lead records for this page's properties ──────────────────────────
  let leadsMap = new Map<string, Record<string, unknown>>()
  if (propIds.length > 0) {
    const { data: leadsData } = await supabase
      .from('leads')
      .select('property_id, id, status, pipeline_stage, starred, lead_score, ai_score, imported_to_contact, source, notes, call_status, sms_status, email_status, offer_sent, offer_pct, offer_amount, blocked, created_at, acquisition_pipeline, surplus_status, follow_up_at, last_contact_at, assigned_to')
      .in('property_id', propIds)

    if (leadsData) {
      leadsMap = new Map(leadsData.map(l => [l.property_id as string, l]))
    }
  }

  // ── Merge properties + leads, apply lead-based filters ────────────────────
  let merged = (properties ?? []).map(prop => {
    const lead = leadsMap.get(prop.id)
    return {
      ...prop,
      lead_id:             lead?.id              ?? null,
      lead_status:         lead?.status          ?? null,
      pipeline_stage:      lead?.pipeline_stage  ?? null,
      starred:             lead?.starred         ?? false,
      lead_score:          lead?.lead_score       ?? null,
      ai_score:            lead?.ai_score         ?? null,
      imported_to_contact: lead?.imported_to_contact ?? null,
      lead_notes:          lead?.notes              ?? null,
      call_status:         lead?.call_status         ?? 'not_called',
      sms_status:          lead?.sms_status          ?? 'not_sent',
      email_status:        lead?.email_status        ?? 'not_sent',
      offer_sent:          lead?.offer_sent          ?? false,
      offer_pct:           lead?.offer_pct           ?? null,
      offer_amount:        lead?.offer_amount        ?? null,
      blocked:              lead?.blocked              ?? false,
      lead_added_at:        lead?.created_at          ?? null,
      is_lead:              !!lead,
      acquisition_pipeline: lead?.acquisition_pipeline ?? null,
      surplus_status:       lead?.surplus_status       ?? null,
      follow_up_at:         lead?.follow_up_at         ?? null,
      last_contact_at:      lead?.last_contact_at      ?? null,
      assigned_to:          lead?.assigned_to          ?? null,
    }
  })

  // Client-side filter for lead-only or non-lead queries
  // (Supabase can't easily filter on the joined leads existence without a view)
  if (is_lead === 'true')  merged = merged.filter(r => r.is_lead)
  if (is_lead === 'false') merged = merged.filter(r => !r.is_lead)

  // Pipeline stage filter (from leads, not properties)
  if (pipeline_stage === 'unassigned') {
    merged = merged.filter(r => r.is_lead && !r.pipeline_stage)
  } else if (pipeline_stage) {
    merged = merged.filter(r => r.pipeline_stage === pipeline_stage)
  }

  // In pipeline = has any pipeline_stage set
  if (in_pipeline === 'true') {
    merged = merged.filter(r => !!r.pipeline_stage)
  }

  // Starred / Following filter
  if (starred === 'true') {
    merged = merged.filter(r => r.starred === true)
  }

  // Imported = has a linked contact
  if (imported === 'true') {
    merged = merged.filter(r => !!r.imported_to_contact)
  }

  // Blocked filter
  if (blocked === 'true') {
    merged = merged.filter(r => r.blocked === true || r.pipeline_stage === 'blocked')
  }

  // AI score min (from leads)
  if (ai_score_min !== null) {
    merged = merged.filter(r => r.ai_score != null && (r.ai_score as number) >= ai_score_min)
  }

  // Acquisition pipeline filter
  if (acquisition_pipeline) {
    merged = merged.filter(r => r.acquisition_pipeline === acquisition_pipeline)
  }

  return NextResponse.json({
    properties: merged,
    // Keep backward-compat 'leads' alias for existing UI code
    leads:  merged,
    total:  count || 0,
    page,
    limit,
    pages:  Math.ceil((count || 0) / limit),
  })
}
