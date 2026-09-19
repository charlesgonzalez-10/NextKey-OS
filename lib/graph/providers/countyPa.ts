/**
 * County Public Records provider — wraps the existing property-sources registry.
 *
 * This adapter makes the existing county PA adapters (Broward, Palm Beach,
 * Miami-Dade, Martin, St. Lucie, Lee) available as a DSOE provider without
 * any changes to the underlying source implementations.
 *
 * Authoritative for: ownership, legal description, assessed value, tax data.
 * Sprint 2+ will add Clerk of Court, Tax Collector, and Official Records
 * as separate providers in the 'public_records' group.
 */

import {
  tryCountyPASources,
  tryFolioLookup,
  isCountySupported,
} from '@/lib/property-sources/registry'
import type {
  DsoeProviderDef,
  DsoeProviderResult,
  DsoeQuery,
} from '../types'

// ── Provider fetch ────────────────────────────────────────────────────────────

async function fetchFromCountyPA(query: DsoeQuery): Promise<DsoeProviderResult> {
  const start = Date.now()

  // Determine which lookup path to use
  const county = (query.county ?? '').toLowerCase()
  let result = null

  try {
    if (query.folio && county && isCountySupported(county)) {
      result = await tryFolioLookup(query.folio, county)
    }

    if (!result && query.address && county && isCountySupported(county)) {
      result = await tryCountyPASources(query.address, county, query.city ?? undefined)
    }

    if (!result) {
      return {
        providerId: 'county-pa',
        data: {},
        success: false,
        durationMs: Date.now() - start,
        error: county ? `No PA source for county: ${county}` : 'No county specified',
      }
    }

    // Map PropertySourceResult → properties table field names for DSOE merge
    const data: Record<string, unknown> = {
      owner_name:       result.owner_name,
      mailing_address:  result.mailing_address,
      owner_state:      result.owner_state,
      owner_zip:        result.owner_zip,
      absentee_owner:   result.absentee_owner,
      homestead:        result.homestead,
      legal_desc:       result.legal_desc,
      zoning:           result.zoning,
      subdivision_name: result.subdivision,
      beds:             result.beds,
      baths:            result.baths,
      living_area:      result.living_area,
      lot_size:         result.lot_size,
      year_built:       result.year_built,
      market_value:     result.market_value,
      assessed_value:   result.assessed_value,
      land_value:       result.land_value,
      building_value:   result.building_value,
      tax_amount:       result.annual_taxes,
      tax_year:         result.tax_year,
      last_sale_date:   result.last_sale_date,
      sold_price:       result.last_sale_amount,
      folio_number:     result.folio,
      property_address: result.property_address,
      city:             result.city,
      state:            result.state,
      zip:              result.zip,
      county:           result.county,
    }

    // Remove nulls — only carry non-null values into the merge
    Object.keys(data).forEach(k => { if (data[k] == null) delete data[k] })

    return {
      providerId: 'county-pa',
      data,
      success: true,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      providerId: 'county-pa',
      data: {},
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ── Provider definition ───────────────────────────────────────────────────────

export const countyPaProvider: DsoeProviderDef = {
  id:    'county-pa',
  group: 'public_records',
  supports: ['ownership', 'valuation', 'full_profile'],
  authoritative_fields: [
    'owner_name', 'mailing_address', 'owner_state', 'owner_zip',
    'absentee_owner', 'homestead', 'legal_desc', 'zoning',
    'subdivision_name', 'assessed_value', 'land_value', 'building_value',
    'tax_amount', 'tax_year', 'folio_number', 'legal_description',
  ],
  estimatedCostCents:    0,    // free — public records scraped from county PA sites
  freshnessTtlHours:     168,  // county PA updates weekly at most (annual roll, quarterly updates)
  confidence:            85,   // authoritative for ownership; assessed value lags market ~12mo
  supportsBatch:         false, // each county scraper is single-property
  supportsWebhooks:      false, // county PA sites do not push; polling only
  supportsManualRefresh: true,
  fetch: fetchFromCountyPA,
}
