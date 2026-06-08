/**
 * Unified property search router for NextKey OS.
 *
 * Routes each request to the right data source based on county:
 *   miami-dade  → Miami-Dade PA REST API (free) + GIS folio lookup
 *   broward     → RealEstateAPI.com (REAPI_KEY required)
 *   palm-beach  → RealEstateAPI.com (REAPI_KEY required)
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

// ─── Supabase service client ──────────────────────────────────────────────────

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
    let query = service
      .from('property_search')
      .select('id, file_date, case_type, lien_amount, multiple_liens, pipeline_stage, starred, lead_score')
      .limit(1)

    if (folio) {
      // Folio match is most precise
      query = query.eq('folio_number', folio)
    } else {
      // Fuzzy address match — normalize both sides
      const norm = address.trim().toUpperCase().replace(/\s+/g, ' ')
      query = query.ilike('property_address', norm)
    }

    const { data } = await query.single()
    if (!data) return undefined

    return {
      lead_id:        data.id,
      file_date:      data.file_date      ?? null,
      case_type:      data.case_type      ?? null,
      lien_amount:    data.lien_amount    ?? null,
      lien_count:     data.multiple_liens ? 2 : 1,
      pipeline_stage: data.pipeline_stage ?? null,
      starred:        data.starred        ?? false,
      lead_score:     data.lead_score     ?? null,
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

// ─── REAPI adapter (Broward / Palm Beach) ────────────────────────────────────

async function searchViaREAPI(
  query: string,
  county: County
): Promise<PropertySearchResult | null> {
  if (!process.env.REAPI_KEY) {
    console.warn('[PropertySearch] REAPI_KEY not set — cannot search Broward/Palm Beach')
    return null
  }

  // Check if looks like a folio
  const cleanedFolio = query.replace(/[^0-9]/g, '')
  if (/^\d{10,15}$/.test(cleanedFolio)) {
    return getPropertyByAPN(cleanedFolio, county)
  }

  return getPropertyDetailByAddress(query, county)
}

// ─── Main unified search entry point ─────────────────────────────────────────

export async function searchProperty(
  query: string,
  countyHint?: County
): Promise<PropertySearchResult | null> {
  const county = countyHint && countyHint !== 'unknown'
    ? countyHint
    : detectCounty(query)

  let result: PropertySearchResult | null = null

  if (county === 'miami-dade') {
    result = await searchMiamiDade(query)
  } else if (county === 'broward' || county === 'palm-beach') {
    result = await searchViaREAPI(query, county)
  } else {
    // Unknown county — try Miami-Dade GIS first, then REAPI
    console.log('[PropertySearch] County unknown, trying MD GIS then REAPI')
    result = await searchMiamiDade(query)
    if (!result && process.env.REAPI_KEY) {
      // Arbitrarily try Broward — REAPI will return null if not found
      result = await searchViaREAPI(query, 'broward')
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
  force = false
): Promise<{ result: PropertySearchResult; folio: string } | { skipped: true } | null> {
  const { data: lead } = await service
    .from('properties')
    .select('id, county, folio_number, property_address, city, enriched_at, enrichment_src')
    .eq('id', leadId)
    .single()

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
    result = await searchViaREAPI(address, county as County)
    if (result?.folio) folio = result.folio
  }

  if (!result) return null

  return { result, folio }
}
