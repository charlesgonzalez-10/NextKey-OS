/**
 * Unified property search router for NextKey OS.
 *
 * Layered lookup strategy — free public sources are tried first:
 *   miami-dade  → Miami-Dade PA REST API (free) + GIS folio lookup
 *   broward     → Broward PA (free) → REAPI fallback (paid)
 *   palm-beach  → Palm Beach PA (free) → REAPI fallback (paid)
 *   martin      → Martin PA stub → REAPI fallback (paid)
 *   st-lucie    → St. Lucie PA stub → REAPI fallback (paid)
 *   unknown     → MD GIS → Broward PA → Palm Beach PA → REAPI
 *
 * Also overlays distress/lead data from the properties + leads tables
 * if the property exists in our database.
 *
 * Server-side only.
 */

import { createClient } from '@supabase/supabase-js'
import {
  enrichFromMiamiDadePA,
  findFolioByAddressGIS,
  normalizeFolio,
} from './miami-dade-pa'
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
import type { PropertySourceResult } from '../property-sources/types'
import { tryCountyPASources, tryFolioLookup } from '../property-sources/registry'

// ─── Supabase service client (lazy — avoids build-time env errors) ───────────

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

/**
 * Detect county from a plain-text address.
 * Priority: zip code → city name keywords → default unknown.
 */
export function detectCounty(address: string): County {
  const upper = address.toUpperCase()

  // Extract zip (5-digit block)
  const zipMatch = upper.match(/\b(3[23]\d{3})\b/)
  if (zipMatch) {
    const county = detectCountyFromZip(zipMatch[1])
    if (county !== 'unknown') return county
  }

  // City name heuristics
  if (/\b(MIAMI|HIALEAH|HOMESTEAD|CORAL GABLES|DORAL|KENDALL|MIAMI BEACH|AVENTURA|NORTH MIAMI|OPA[- ]LOCKA|OPA LOCKA)\b/.test(upper)) return 'miami-dade'
  if (/\b(FORT LAUDERDALE|FT\.?\s*LAUDERDALE|HOLLYWOOD|POMPANO|MIRAMAR|PEMBROKE|SUNRISE|PLANTATION|DAVIE|CORAL SPRINGS|DEERFIELD|HALLANDALE|WESTON|TAMARAC|MARGATE|COCONUT CREEK)\b/.test(upper)) return 'broward'
  if (/\b(WEST PALM BEACH|BOCA RATON|DELRAY BEACH|LAKE WORTH|BOYNTON BEACH|PALM BEACH GARDENS|WELLINGTON|JUPITER|PALM SPRINGS|GREENACRES|RIVIERA BEACH|ROYAL PALM)\b/.test(upper)) return 'palm-beach'

  return 'unknown'
}

// ─── Distress overlay ─────────────────────────────────────────────────────────

/**
 * Check if a property is in the database and return distress/lead data if so.
 * Uses the property_search view (properties LEFT JOIN leads) to get both
 * property fields and any existing lead status in a single query.
 * Matches on folio number (preferred) or normalized address string.
 */
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
      // Folio match is most precise
      query = query.eq('folio_number', folio)
    } else {
      // Fuzzy address match — normalize both sides
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

// ─── Miami-Dade adapter ───────────────────────────────────────────────────────

async function searchMiamiDade(
  query: string
): Promise<PropertySearchResult | null> {
  // Determine if query looks like a folio (13 digits) or address
  const cleanedFolio = query.replace(/[^0-9]/g, '')
  const isFolio = /^\d{10,13}$/.test(cleanedFolio)

  let folio: string | null = null

  if (isFolio) {
    folio = normalizeFolio(query)
  } else {
    // Address → GIS folio lookup
    const found = await findFolioByAddressGIS(query)
    if (found) folio = found.folio
  }

  if (!folio) return null

  const result = await enrichFromMiamiDadePA(folio)
  if (!result) return null

  const propAddr = query  // the address user typed

  // Build PropertySearchResult from PAEnrichmentResult
  const mailAddr = result.mailing_address
  const absentee = !!mailAddr &&
    !mailAddr.toUpperCase().includes(propAddr.toUpperCase().split(' ').slice(0, 2).join(' '))

  return {
    folio,
    county:  'miami-dade',
    source:  'miami-dade-pa',

    property_address: propAddr,
    city:             'Miami',
    state:            'FL',
    zip:              result.owner_zip ?? '',

    owner_name:       result.owner_name,
    mailing_address:  result.mailing_address,
    owner_city:       null,
    owner_state:      result.owner_state,
    owner_zip:        result.owner_zip,
    owner_country:    result.owner_country,
    absentee_owner:   absentee,

    property_use:     result.property_use,
    zoning:           result.zoning,
    legal_desc:       result.legal_desc,
    subdivision:      result.subdivision,
    neighborhood:     result.subdivision,
    municipality:     null,

    beds:             result.beds,
    baths:            result.baths,
    half_baths:       null,
    living_area:      result.living_area,
    building_area:    null,
    lot_size:         result.lot_size,
    year_built:       result.year_built,
    stories:          null,
    units:            null,

    market_value:     result.market_value,
    assessed_value:   result.assessed_value,
    land_value:       result.land_value,
    building_value:   result.building_value,
    tax_year:         result.tax_year,
    annual_taxes:     null,

    last_sale_date:   result.last_sale_date,
    last_sale_amount: result.last_sale_amount,
    prev_sale_date:   result.prev_sale_date,
    prev_sale_amount: result.prev_sale_amount,

    pa_url: folio
      ? `https://www.miamidade.gov/propertysearch/#/?folio=${folio}`
      : null,

    raw: result.raw,
  }
}

// ─── Convert PropertySourceResult → PropertySearchResult ─────────────────────

/**
 * Maps a normalized PropertySourceResult (from any county PA adapter) into
 * the canonical PropertySearchResult shape used throughout the app.
 */
export function convertSourceResult(
  r: PropertySourceResult,
  county: County
): PropertySearchResult {
  const propAddr   = r.property_address ?? ''
  const mailAddr   = r.mailing_address  ?? null
  const absentee   = r.absentee_owner  !== undefined
    ? r.absentee_owner
    : !!(mailAddr && propAddr &&
        !mailAddr.toUpperCase().includes(
          propAddr.toUpperCase().split(' ').slice(0, 2).join(' ')
        ))

  // Map source name to DataSource enum
  const sourceMap: Record<string, PropertySearchResult['source']> = {
    'broward_pa':    'broward-pa',
    'palm_beach_pa': 'palm-beach-pa',
    'martin_pa':     'martin-pa',
    'st_lucie_pa':   'st-lucie-pa',
    'miami_dade_pa': 'miami-dade-pa',
    'reapi':         'reapi',
  }
  const source = sourceMap[r.source] ?? 'reapi'

  return {
    folio:            r.folio             ?? null,
    county,
    source,

    property_address: propAddr,
    city:             r.city              ?? '',
    state:            r.state             ?? 'FL',
    zip:              r.zip               ?? '',

    owner_name:       r.owner_name        ?? null,
    mailing_address:  mailAddr,
    owner_city:       r.owner_city        ?? null,
    owner_state:      r.owner_state       ?? null,
    owner_zip:        r.owner_zip         ?? null,
    owner_country:    r.owner_country     ?? null,
    absentee_owner:   absentee,

    property_use:     r.property_use      ?? null,
    zoning:           r.zoning            ?? null,
    legal_desc:       r.legal_desc        ?? null,
    subdivision:      r.subdivision       ?? null,
    neighborhood:     r.neighborhood      ?? null,
    municipality:     r.municipality      ?? null,

    beds:             r.beds              ?? null,
    baths:            r.baths             ?? null,
    half_baths:       r.half_baths        ?? null,
    living_area:      r.living_area       ?? null,
    building_area:    r.building_area     ?? null,
    lot_size:         r.lot_size          ?? null,
    year_built:       r.year_built        ?? null,
    stories:          r.stories           ?? null,
    units:            r.units             ?? null,

    market_value:     r.market_value      ?? null,
    assessed_value:   r.assessed_value    ?? null,
    land_value:       r.land_value        ?? null,
    building_value:   r.building_value    ?? null,
    tax_year:         r.tax_year          ?? null,
    annual_taxes:     r.annual_taxes      ?? null,

    last_sale_date:   r.last_sale_date    ?? null,
    last_sale_amount: r.last_sale_amount  ?? null,
    prev_sale_date:   r.prev_sale_date    ?? null,
    prev_sale_amount: r.prev_sale_amount  ?? null,

    pa_url: r.pa_url ?? r.sourceUrl ?? null,

    // Source provenance fields
    source_display:    r.sourceDisplayName,
    source_type:       r.sourceType,
    source_url:        r.sourceUrl ?? null,
    source_confidence: r.confidence,
    source_checked_at: new Date().toISOString(),
    needs_enrichment:  r.confidence < 75,

    raw: r.raw ?? r,
  }
}

// ─── County PA adapter (Broward / Palm Beach / Martin / St. Lucie) ───────────

/**
 * Try free county PA sources first for Broward, Palm Beach, Martin, St. Lucie.
 * Returns a PropertySearchResult if found, null if all PA sources fail.
 * REAPI should be used as fallback when this returns null.
 */
async function searchViaCountyPA(
  query: string,
  county: County
): Promise<PropertySearchResult | null> {
  // Check if query looks like a folio
  const cleanedFolio = query.replace(/[^0-9]/g, '')
  const isFolio = /^\d{10,15}$/.test(cleanedFolio)

  let sourceResult: PropertySourceResult | null = null

  if (isFolio) {
    sourceResult = await tryFolioLookup(cleanedFolio, county)
  } else {
    sourceResult = await tryCountyPASources(query, county)
  }

  if (!sourceResult) return null
  return convertSourceResult(sourceResult, county)
}

// ─── REAPI adapter (Broward / Palm Beach / paid fallback) ────────────────────

async function searchViaREAPI(
  query: string,
  county: County,
  billing?: BillingContext
): Promise<PropertySearchResult | null> {
  if (!billing) {
    console.warn('[PropertySearch] No billing context — REAPI fallback skipped')
    return null
  }

  // Check if looks like a folio
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

  let result: PropertySearchResult | null = null

  if (county === 'miami-dade') {
    result = await searchMiamiDade(query)
  } else if (county === 'broward' || county === 'palm-beach') {
    // Try free county PA first; only fall back to REAPI if PA fails
    console.log(`[PropertySearch] Trying ${county} PA (free) first`)
    result = await searchViaCountyPA(query, county)
    if (!result) {
      console.log(`[PropertySearch] ${county} PA returned null — falling back to REAPI`)
      result = await searchViaREAPI(query, county, billing)
    }
  } else if (county === 'martin' || county === 'st-lucie') {
    // Stubs return null → go straight to REAPI
    result = await searchViaCountyPA(query, county)
    if (!result) {
      result = await searchViaREAPI(query, county, billing)
    }
  } else {
    // Unknown county — try Miami-Dade GIS, then Broward PA, then Palm Beach PA, then REAPI
    console.log('[PropertySearch] County unknown, trying MD GIS → Broward PA → Palm Beach PA → REAPI')
    result = await searchMiamiDade(query)
    if (!result) {
      result = await searchViaCountyPA(query, 'broward')
    }
    if (!result) {
      result = await searchViaCountyPA(query, 'palm-beach')
    }
    if (!result) {
      result = await searchViaREAPI(query, 'broward', billing)
    }
  }

  if (!result) return null

  // Overlay distress/lead data from properties + leads (via property_search view)
  result.distress = await fetchDistressData(result.property_address, result.folio)

  return result
}

// ─── Batch folio enrichment (for property enrichment jobs) ───────────────────

/**
 * Enrich a single property by ID. Used by the /api/leads/[id]/enrich route.
 * Returns the normalized PropertySearchResult so the route can store it.
 */
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

  // Skip if already enriched unless forced
  if (!force && lead.enriched_at && lead.enrichment_src) {
    return { skipped: true }
  }

  const county = (lead.county as County) ?? detectCounty(lead.property_address ?? '')
  const address = lead.property_address ?? ''

  let result: PropertySearchResult | null = null
  let folio = lead.folio_number ?? null

  if (county === 'miami-dade') {
    result = await searchMiamiDade(folio ? `folio:${folio}` : address)
    if (result?.folio) folio = result.folio
  } else {
    result = await searchViaREAPI(address, county as County, billing)
    if (result?.folio) folio = result.folio
  }

  if (!result) return null

  return { result, folio }
}
