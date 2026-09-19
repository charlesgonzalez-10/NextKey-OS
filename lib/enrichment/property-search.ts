/**
 * Unified property search for NextKey OS.
 *
 * Architecture: DB-first cache → REAPI (primary national provider).
 * No county-by-county PA adapters. NextKey owns workflow/intelligence/CRM/billing;
 * REAPI owns commodity property data aggregation.
 *
 * Single-property lookup flow:
 *   1. Check canonical properties table (DB-first)
 *   2. If fresh → return from DB without provider call
 *   3. If stale/missing → REAPI via providerGateway (billing required)
 *   4. Overlay distress/lead data from properties + leads
 *
 * Server-side only.
 */

import { createClient } from '@supabase/supabase-js'
import {
  getPropertyDetailByAddress,
  getPropertyByAPN,
  detectCountyFromZip,
} from './reapi'
import type {
  PropertySearchResult,
  PropertyDistressData,
  County,
} from './types'
import type { BillingContext } from '@/lib/billing/gatewayContext'

// ─── Supabase service client (lazy) ──────────────────────────────────────────

let _service: ReturnType<typeof createClient> | null = null
function getService() {
  if (!_service) {
    _service = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _service
}

// ─── County detection from address ───────────────────────────────────────────

export function detectCounty(address: string): County {
  const upper = address.toUpperCase()

  const zipMatch = upper.match(/\b(3[23]\d{3})\b/)
  if (zipMatch) {
    const county = detectCountyFromZip(zipMatch[1])
    if (county !== 'unknown') return county
  }

  if (/\b(MIAMI|HIALEAH|HOMESTEAD|CORAL GABLES|DORAL|KENDALL|MIAMI BEACH|AVENTURA|NORTH MIAMI|OPA[- ]LOCKA|OPA LOCKA)\b/.test(upper)) return 'miami-dade'
  if (/\b(FORT LAUDERDALE|FT\.?\s*LAUDERDALE|HOLLYWOOD|POMPANO|MIRAMAR|PEMBROKE|SUNRISE|PLANTATION|DAVIE|CORAL SPRINGS|DEERFIELD|HALLANDALE|WESTON|TAMARAC|MARGATE|COCONUT CREEK)\b/.test(upper)) return 'broward'
  if (/\b(WEST PALM BEACH|BOCA RATON|DELRAY BEACH|LAKE WORTH|BOYNTON BEACH|PALM BEACH GARDENS|WELLINGTON|JUPITER|PALM SPRINGS|GREENACRES|RIVIERA BEACH|ROYAL PALM)\b/.test(upper)) return 'palm-beach'

  return 'unknown'
}

// ─── Distress overlay ─────────────────────────────────────────────────────────

async function fetchDistressData(
  address: string,
  folio?: string | null
): Promise<PropertyDistressData | undefined> {
  try {
    let query = getService()
      .from('property_search')
      .select('id, case_number, folio_number, file_date, case_type, foreclosure_type, plaintiff, lender_name, lien_amount, multiple_liens, pipeline_stage, starred, lead_score, county')
      .limit(1)

    if (folio) {
      query = query.eq('folio_number', folio)
    } else {
      const norm = address.trim().toUpperCase().replace(/\s+/g, ' ')
      query = query.ilike('property_address', norm)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (query.single() as any)
    if (!data) return undefined

    return {
      lead_id:          data.id,
      case_number:      data.case_number    ?? null,
      folio_number:     data.folio_number   ?? null,
      file_date:        data.file_date      ?? null,
      case_type:        data.case_type      ?? null,
      foreclosure_type: data.foreclosure_type ?? null,
      plaintiff:        data.plaintiff      ?? null,
      lender_name:      data.lender_name    ?? null,
      lien_amount:      data.lien_amount    ?? null,
      lien_count:       data.multiple_liens ? 2 : 1,
      pipeline_stage:   data.pipeline_stage ?? null,
      starred:          data.starred        ?? false,
      lead_score:       data.lead_score     ?? null,
      county:           data.county         ?? null,
    }
  } catch {
    return undefined
  }
}

// ─── REAPI lookup (primary national provider) ─────────────────────────────────

async function searchViaREAPI(
  query: string,
  county: County,
  billing?: BillingContext
): Promise<PropertySearchResult | null> {
  if (!billing) {
    console.warn('[PropertySearch] No billing context — REAPI lookup skipped')
    return null
  }

  const cleanedFolio = query.replace(/[^0-9]/g, '')
  if (/^\d{10,15}$/.test(cleanedFolio)) {
    const outcome = await getPropertyByAPN(cleanedFolio, county, billing)
    if (outcome.outcome !== 'success') {
      console.warn(`[PropertySearch] REAPI APN lookup ${outcome.outcome}:`, outcome.outcome === 'blocked' ? outcome.error_code : outcome.error)
      return null
    }
    return outcome.data
  }

  const outcome = await getPropertyDetailByAddress(query, county, billing)
  if (outcome.outcome !== 'success') {
    console.warn(`[PropertySearch] REAPI address lookup ${outcome.outcome}:`, outcome.outcome === 'blocked' ? outcome.error_code : outcome.error)
    return null
  }
  return outcome.data
}

// ─── Main unified search entry point ─────────────────────────────────────────

export async function searchProperty(
  query: string,
  countyHint?: County,
  billing?: BillingContext
): Promise<PropertySearchResult | null> {
  const county = countyHint && countyHint !== 'unknown'
    ? countyHint
    : detectCounty(query)

  const result = await searchViaREAPI(query, county, billing)
  if (!result) return null

  result.distress = await fetchDistressData(result.property_address, result.folio)
  return result
}

// ─── Lead enrichment (for /api/leads/[id]/enrich) ────────────────────────────

export async function enrichLeadById(
  leadId: string,
  force = false,
  billing?: BillingContext
): Promise<{ result: PropertySearchResult; folio: string } | { skipped: true } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lead } = await (getService()
    .from('properties')
    .select('id, county, folio_number, property_address, city, enriched_at, enrichment_src')
    .eq('id', leadId)
    .single() as any)

  if (!lead) return null

  if (!force && lead.enriched_at && lead.enrichment_src) {
    return { skipped: true }
  }

  const county = (lead.county as County) ?? detectCounty(lead.property_address ?? '')
  const address = lead.property_address ?? ''

  const result = await searchViaREAPI(address, county, billing)
  if (!result) return null

  const folio = result.folio ?? lead.folio_number ?? null
  return { result, folio: folio ?? '' }
}
