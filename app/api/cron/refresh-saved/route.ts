/**
 * Vercel Cron — Daily Refresh for Saved Properties
 *
 * Runs daily Mon–Fri at 9 AM ET (14:00 UTC).
 * Schedule in vercel.json: { "path": "/api/cron/refresh-saved", "schedule": "0 14 * * 1-5" }
 *
 * ONLY refreshes properties that are actively saved (in leads / pipeline / deals).
 * Does NOT sweep the entire market. This keeps REAPI costs minimal.
 *
 * For each saved property with a folio_number:
 *   1. Fetch current data from REAPI by APN
 *   2. Update: market_value, known_debt, equity, foreclosure status,
 *              MLS status, lender_name, file_date, is_auction
 *
 * Response:
 *   { refreshed, skipped, errors, duration_ms }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { lookupCaseNumber } from '@/lib/ingestion/reapi-case-lookup'
import { markModuleRefreshed } from '@/lib/propertyService'
import { getPropertyByAPN } from '@/lib/enrichment/reapi'
import { BACKGROUND_CONTEXT } from '@/lib/billing/gatewayContext'
import type { County } from '@/lib/enrichment/types'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (process.env.CRON_REFRESH_SAVED_ENABLED === 'false') {
    console.log('[RefreshSaved] Skipped — CRON_REFRESH_SAVED_ENABLED=false')
    return NextResponse.json({ status: 'paused', reason: 'cron_disabled' })
  }

  const supabase  = getSupabase()
  const startedAt = Date.now()

  // ── Get all saved properties with a folio number ─────────────────────────
  // A "saved" property is one that has at least one lead (not archived)
  // Fetch active lead property_ids first, then query properties
  const { data: activeLeads } = await supabase
    .from('leads')
    .select('property_id')
    .neq('status', 'archived')

  const activePropIds = (activeLeads ?? []).map(l => l.property_id).filter(Boolean)

  if (activePropIds.length === 0) {
    return NextResponse.json({ refreshed: 0, skipped: 0, errors: 0, duration_ms: Date.now() - startedAt, total: 0 })
  }

  const { data: savedProps, error } = await supabase
    .from('properties')
    .select('id, folio_number, county, case_number')
    .not('folio_number', 'is', null)
    .in('id', activePropIds)
    .limit(500)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const props = savedProps ?? []
  let refreshed = 0, skipped = 0, errors = 0

  // ── Batch freshness check — one query for all properties ─────────────────
  // The foreclosure module has a 30-day TTL (shortest L2 tier).
  // Any property whose foreclosure module is still fresh is skipped entirely —
  // valuation (90d) and mortgage (90d) will also still be fresh by definition.
  const FC_TTL_DAYS = 30
  const { data: freshnessRows } = await supabase
    .from('property_freshness')
    .select('property_id, refreshed_at')
    .in('property_id', props.map(p => p.id))
    .eq('module', 'foreclosure')

  const nowMs = Date.now()
  const freshIds = new Set(
    (freshnessRows ?? [])
      .filter(r => (nowMs - new Date(r.refreshed_at).getTime()) / 86_400_000 < FC_TTL_DAYS)
      .map(r => r.property_id)
  )

  // ── Priority ordering via property_search_history ─────────────────────────
  // Refresh high-frequency properties first in case the run hits a time limit.
  // property_search_history tracks how often each property is opened in the workspace.
  const staleProps = props.filter(p => p.folio_number && !freshIds.has(p.id))

  const { data: searchRows } = await supabase
    .from('property_search_history')
    .select('property_id, search_frequency, search_count')
    .in('property_id', staleProps.map(p => p.id))

  const FREQ_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const searchMap = new Map((searchRows ?? []).map(r => [r.property_id, r]))
  staleProps.sort((a, b) => {
    const fa = FREQ_ORDER[searchMap.get(a.id)?.search_frequency ?? ''] ?? 3
    const fb = FREQ_ORDER[searchMap.get(b.id)?.search_frequency ?? ''] ?? 3
    return fa - fb
  })

  // Properties with fresh foreclosure data are already skipped — count them
  skipped += props.length - staleProps.length

  console.log(`[RefreshSaved] ${props.length} total — ${staleProps.length} stale, ${freshIds.size} already fresh`)

  for (const prop of staleProps) {

    try {
      const county  = (prop.county as County) ?? 'broward'
      const outcome = await getPropertyByAPN(prop.folio_number, county, BACKGROUND_CONTEXT)

      if (outcome.outcome === 'blocked') {
        const tag = outcome.error_code === 'pool_exhausted' ? 'background_paused_by_budget' : outcome.error_code
        console.warn(`[RefreshSaved] REAPI blocked for ${prop.folio_number}: ${tag}`)
        skipped++
        continue
      }
      if (outcome.outcome === 'provider_failed' || !outcome.data) {
        skipped++
        continue
      }

      // Access raw REAPI fields preserved in the .raw property
      const fresh = outcome.data.raw as Record<string, unknown>

      const equityPct = fresh.equityPercent as number ?? null
      const mktVal    = fresh.estimatedValue as number ?? outcome.data.market_value
      const debt      = fresh.openMortgageBalance as number ?? null
      const equityAmt = mktVal != null && debt != null ? Math.max(0, mktVal - debt) : null

      const equityTier =
        equityPct == null || (equityPct as number) <= 0 ? 'None'
        : (equityPct as number) >= 50 ? 'High'
        : (equityPct as number) >= 20 ? 'Medium'
        : 'Low'

      // ── Case number lookup (for properties that still have null) ──────────
      let caseNumber: string | null = prop.case_number ?? null
      if (!caseNumber && prop.county) {
        const lookup = await lookupCaseNumber({
          apn:    prop.folio_number,
          county: prop.county,
          billing: BACKGROUND_CONTEXT,
        })
        if (lookup.outcome === 'found') {
          caseNumber = lookup.case_number
        } else if (lookup.outcome === 'budget_paused') {
          console.warn(`[RefreshSaved] case lookup budget_paused for ${prop.folio_number}: ${lookup.error_code}`)
        }
      }

      const { error: updErr } = await supabase
        .from('properties')
        .update({
          market_value:         mktVal,
          known_debt:           debt,
          equity_percentage:    equityPct,
          equity_dollar_amount: equityAmt,
          equity_tier:          equityTier,
          high_equity:          equityTier === 'High',
          is_pre_foreclosure:   fresh.preForeclosure   ?? false,
          is_foreclosure:       fresh.foreclosure      ?? false,
          is_auction:           fresh.auction          ?? false,
          lender_name:          fresh.lenderName       ?? null,
          plaintiff:            fresh.lenderName       ?? null,
          mls_status:           fresh.mlsStatus        ?? null,
          mls_listing_price:    fresh.mlsListingPrice  ?? null,
          ...(caseNumber ? { case_number: caseNumber } : {}),
          raw_reapi:            fresh,
          updated_at:           new Date().toISOString(),
        })
        .eq('id', prop.id)

      if (updErr) {
        errors++
        console.error(`[RefreshSaved] ${prop.folio_number}:`, updErr.message)
      } else {
        refreshed++
        void Promise.all([
          markModuleRefreshed(prop.id, 'foreclosure', 'reapi-cron'),
          markModuleRefreshed(prop.id, 'valuation',   'reapi-cron'),
          markModuleRefreshed(prop.id, 'mortgage',    'reapi-cron'),
        ]).catch(() => {})
      }

    } catch (err) {
      errors++
      console.error(`[RefreshSaved] APN ${prop.folio_number} error:`, err)
    }
  }

  // ── Also purge expired search cache entries ───────────────────────────────
  await supabase
    .from('search_cache')
    .delete()
    .lt('expires_at', new Date().toISOString())

  const duration_ms = Date.now() - startedAt
  console.log(`[RefreshSaved] Done — ${refreshed} refreshed, ${skipped} skipped, ${errors} errors (${duration_ms}ms)`)

  return NextResponse.json({ refreshed, skipped, errors, duration_ms, total: props.length })
}
