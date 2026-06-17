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

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

const REAPI_BASE = 'https://api.realestateapi.com/v2'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchREAPIByAPN(apn: string): Promise<Record<string, any> | null> {
  const key = process.env.REAPI_KEY
  if (!key) return null

  const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body:    JSON.stringify({ apn, state: 'FL', size: 1 }),
    signal:  AbortSignal.timeout(15_000),
  })

  if (!res.ok) return null
  const data = await res.json()
  return data?.data?.[0] ?? null
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  console.log(`[RefreshSaved] Refreshing ${props.length} saved properties`)

  for (const prop of props) {
    if (!prop.folio_number) { skipped++; continue }

    try {
      const fresh = await fetchREAPIByAPN(prop.folio_number)
      if (!fresh) { skipped++; continue }

      const equityPct = fresh.equityPercent ?? null
      const mktVal    = fresh.estimatedValue ?? null
      const debt      = fresh.openMortgageBalance ?? null
      const equityAmt = mktVal != null && debt != null ? Math.max(0, mktVal - debt) : null

      const equityTier =
        equityPct == null || equityPct <= 0 ? 'None'
        : equityPct >= 50 ? 'High'
        : equityPct >= 20 ? 'Medium'
        : 'Low'

      // ── Case number lookup (for properties that still have null) ──────────
      let caseNumber: string | null = prop.case_number ?? null
      if (!caseNumber && prop.county) {
        const lookup = await lookupCaseNumber({ apn: prop.folio_number, county: prop.county })
        if (lookup.case_number) caseNumber = lookup.case_number
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

      if (updErr) { errors++; console.error(`[RefreshSaved] ${prop.folio_number}:`, updErr.message) }
      else refreshed++

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
