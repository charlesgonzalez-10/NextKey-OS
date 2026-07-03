/**
 * Layered property source registry.
 *
 * Orchestrates county PA adapters in order. Returns the first successful result.
 * If all free public sources fail → returns null so the caller can fall back to REAPI.
 *
 * County → source priority:
 *   broward    → Broward PA (free) → null (REAPI fallback by caller)
 *   palm-beach → Palm Beach PA (free) → null (REAPI fallback by caller)
 *   miami-dade → handled by existing searchMiamiDade() in property-search.ts
 *   martin     → stub (null) → REAPI fallback
 *   st-lucie   → stub (null) → REAPI fallback
 */

import type { PropertySourceResult } from './types'
import { searchByAddress as browardAddressSearch,    searchByFolio as browardFolioSearch    } from './broward-pa'
import { searchByAddress as palmBeachAddressSearch,  searchByFolio as palmBeachFolioSearch  } from './palm-beach-pa'
import { searchByAddress as martinAddressSearch,     searchByFolio as martinFolioSearch     } from './martin-pa'
import { searchByAddress as stLucieAddressSearch,    searchByFolio as stLucieFolioSearch    } from './st-lucie-pa'
import { searchByAddress as miamiDadeAddressSearch,  searchByFolio as miamiDadeFolioSearch  } from './miami-dade-pa'
import { searchByAddress as leeAddressSearch,         searchByFolio as leeFolioSearch         } from './lee-pa'

// ─── County → ordered list of address-search functions ───────────────────────

type AddressSearchFn = (address: string, city?: string) => Promise<PropertySourceResult | null>
type FolioSearchFn   = (folio: string) => Promise<PropertySourceResult | null>

const COUNTY_ADDRESS_SOURCES: Record<string, AddressSearchFn[]> = {
  'miami-dade': [miamiDadeAddressSearch],
  'broward':    [browardAddressSearch],
  'palm-beach': [palmBeachAddressSearch],
  'martin':     [martinAddressSearch],
  'st-lucie':   [stLucieAddressSearch],
  'lee':        [leeAddressSearch],
}

const COUNTY_FOLIO_SOURCES: Record<string, FolioSearchFn[]> = {
  'miami-dade': [miamiDadeFolioSearch],
  'broward':    [browardFolioSearch],
  'palm-beach': [palmBeachFolioSearch],
  'martin':     [martinFolioSearch],
  'st-lucie':   [stLucieFolioSearch],
  'lee':        [leeFolioSearch],
}

/** True if a normalized county slug has at least one registered source. */
export function isCountySupported(normalizedCounty: string): boolean {
  return (COUNTY_ADDRESS_SOURCES[normalizedCounty]?.length ?? 0) > 0
    || (COUNTY_FOLIO_SOURCES[normalizedCounty]?.length ?? 0) > 0
}

// ─── Exported orchestrators ───────────────────────────────────────────────────

/**
 * Try county PA sources in order. Returns the first successful (non-null) result.
 * Returns null if all sources fail — caller should then try REAPI.
 */
export async function tryCountyPASources(
  address: string,
  county: string,
  city?: string
): Promise<PropertySourceResult | null> {
  const sources = COUNTY_ADDRESS_SOURCES[county.toLowerCase()] ?? []

  for (const searchFn of sources) {
    try {
      const result = await searchFn(address, city)
      if (result) {
        console.log(`[PropertySources] Found via ${result.source} for "${address}"`)
        return result
      }
    } catch (err) {
      console.warn(`[PropertySources] Address source failed for ${county}:`, err)
    }
  }

  return null
}

/**
 * Try county PA folio sources in order. Returns the first successful result.
 * Returns null if all sources fail — caller should then try REAPI.
 */
export async function tryFolioLookup(
  folio: string,
  county: string
): Promise<PropertySourceResult | null> {
  const sources = COUNTY_FOLIO_SOURCES[county.toLowerCase()] ?? []

  for (const searchFn of sources) {
    try {
      const result = await searchFn(folio)
      if (result) {
        console.log(`[PropertySources] Found via ${result.source} for folio "${folio}"`)
        return result
      }
    } catch (err) {
      console.warn(`[PropertySources] Folio source failed for ${county}:`, err)
    }
  }

  return null
}
