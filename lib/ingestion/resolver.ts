/**
 * OR Record → Folio Resolver
 *
 * Takes a raw ORRecord (as extracted from a county OR index feed) and resolves
 * it to a verified folio/APN. This is the bridge between the court filing world
 * and the physical property world.
 *
 * Resolution strategy (in order):
 *   1. Try to extract a folio directly from the legal description string
 *      (Broward and Palm Beach often embed the parcel number in legal descriptions).
 *   2. If a property address is present, look it up via the county PA / REAPI.
 *      – Miami-Dade: use the free GIS parcel layer (no API key needed).
 *      – Broward / Palm Beach: use REAPI PropertySearch (requires REAPI_KEY).
 *   3. Return null if resolution fails — the record is stored with null folio_number
 *      and flagged for manual review. It still flows into the pipeline; the
 *      investor can resolve the address manually from the Lead Detail page.
 *
 * Address normalisation is done before every lookup to maximise match rate.
 * The normaliser here is more aggressive than the one in miami-dade-pa.ts
 * because OR index addresses can be far messier (USPS abbreviations, periods,
 * ordinal number words, #/unit suffixes, etc.).
 */

import type { ORRecord }   from './adapters/types'
import type { County }     from '@/lib/scrapers/types'
import { findFolioByAddressGIS } from '@/lib/enrichment/miami-dade-pa'
import { getPropertyDetailByAddress } from '@/lib/enrichment/reapi'
import { BACKGROUND_CONTEXT } from '@/lib/billing/gatewayContext'

// ─── Address normalisation ────────────────────────────────────────────────────

/**
 * Expanded direction abbreviation map — handles dotted versions and longhand
 * that sometimes appear in court records.
 */
const DIR_MAP: Record<string, string> = {
  'N.':   'N',  'S.':  'S',  'E.': 'E',  'W.': 'W',
  'N.E.': 'NE', 'N.W.':'NW', 'S.E.':'SE','S.W.':'SW',
  'NORTH':'N',  'SOUTH':'S', 'EAST':'E', 'WEST':'W',
  'NORTHEAST':'NE','NORTHWEST':'NW','SOUTHEAST':'SE','SOUTHWEST':'SW',
}

/**
 * Street type longhand → USPS abbreviation map.
 * Used to normalise "AVENUE" → "AVE", "FIRST" ordinals, etc.
 */
const TYPE_MAP: Record<string, string> = {
  AVENUE:     'AVE',  BOULEVARD: 'BLVD', CIRCLE:    'CIR',
  COURT:      'CT',   DRIVE:     'DR',   EXPRESSWAY:'EXPY',
  FREEWAY:    'FWY',  HIGHWAY:   'HWY',  LANE:      'LN',
  LOOP:       'LOOP', PARKWAY:   'PKWY', PLACE:     'PL',
  ROAD:       'RD',   STREET:    'ST',   TERRACE:   'TER',
  TERR:       'TER',  TRAIL:     'TRL',  WAY:       'WAY',
}

/** Ordinal word → numeric string map for street names */
const ORDINAL_MAP: Record<string, string> = {
  FIRST:'1ST',  SECOND:'2ND', THIRD:'3RD',  FOURTH:'4TH',
  FIFTH:'5TH',  SIXTH:'6TH',  SEVENTH:'7TH',EIGHTH:'8TH',
  NINTH:'9TH',  TENTH:'10TH', ELEVENTH:'11TH',TWELFTH:'12TH',
  THIRTEENTH:'13TH', FOURTEENTH:'14TH', FIFTEENTH:'15TH',
  SIXTEENTH:'16TH',  SEVENTEENTH:'17TH',EIGHTEENTH:'18TH',
  NINETEENTH:'19TH', TWENTIETH:'20TH',
}

/**
 * Normalise a raw court-record address string to the standard uppercase
 * abbreviated form expected by the PA and REAPI APIs.
 *
 * Examples:
 *   "100 N.W. FIRST AVE."   → "100 NW 1ST AVE"
 *   "100 Nw 1st Ave."       → "100 NW 1ST AVE"
 *   "2345 S.W. 47TH TER #A" → "2345 SW 47TH TER"
 *   "1 South Ocean Blvd"    → "1 S OCEAN BLVD"
 */
export function normalizeCourtAddress(raw: string): string {
  if (!raw) return ''

  let s = raw.trim().toUpperCase()

  // 1. Strip trailing city/state/zip if present ("100 NW 1ST AVE, MIAMI FL 33136")
  s = s.replace(/,\s*[A-Z\s]+,?\s*(FL|FLORIDA)?\s*\d{5}(-\d{4})?$/, '')
  s = s.replace(/,\s*[A-Z\s]{2,},?\s*\d{5}(-\d{4})?$/, '')

  // 2. Remove dots from abbreviations (N.W. → NW, etc.)
  s = s.replace(/\b([NSEW])\.([NSEW])\./g, '$1$2')   // S.W. → SW
  s = s.replace(/\b([NSEW])\./g, '$1')                 // N. → N

  // 3. Replace directional longhand
  for (const [from, to] of Object.entries(DIR_MAP)) {
    const escaped = from.replace(/\./g, '\\.')
    s = s.replace(new RegExp(`\\b${escaped}\\b`, 'g'), to)
  }

  // 4. Replace ordinal number words ("FIRST" → "1ST")
  for (const [word, num] of Object.entries(ORDINAL_MAP)) {
    s = s.replace(new RegExp(`\\b${word}\\b`, 'g'), num)
  }

  // 5. Normalise street type longhand ("AVENUE" → "AVE")
  for (const [from, to] of Object.entries(TYPE_MAP)) {
    s = s.replace(new RegExp(`\\b${from}\\.?\\b`, 'g'), to)
  }

  // 6. Strip unit/suite/apt suffixes
  s = s
    .replace(/\s*#\s*[\w/-]+\s*$/, '')
    .replace(/\s+(?:APT|UNIT|STE|SUITE|FL|FLOOR|RM|ROOM)\s+\S+\s*$/i, '')
    .replace(/\s+[A-Z]\s*$/, '')     // trailing bare single letter (unit)

  // 7. Collapse multiple spaces
  s = s.replace(/\s{2,}/g, ' ').trim()

  return s
}

// ─── Folio extraction from legal description ──────────────────────────────────

/**
 * Many OR index records embed the parcel ID in the legal description field.
 * Common formats:
 *   - "FOLIO: 3048431700000A0101"
 *   - "PARCEL NO: 504-08-43-17-000001"
 *   - "PCN: 00-42-43-17-00-000-1010"
 *   - Broward: "LOT 5 BLK 2 OF ACME PLAT PB 45/32 FOLIO 504108430010"
 *
 * Returns a sanitised folio (digits only) or null if not found.
 */
export function extractFolioFromLegal(legal: string | undefined): string | null {
  if (!legal) return null

  const upper = legal.toUpperCase()

  // Explicit "FOLIO:" or "PCN:" or "PARCEL" label
  const labeled = upper.match(
    /(?:FOLIO|PCN|PARCEL\s*(?:NO|NUMBER|ID|#))\s*[:#]?\s*([\dA-Z-]+)/
  )
  if (labeled) {
    const clean = labeled[1].replace(/[^0-9A-Z]/g, '')
    if (clean.length >= 10) return clean
  }

  // Standalone 13-digit number (Miami-Dade format: 0112340567890)
  const md13 = upper.match(/\b(\d{13})\b/)
  if (md13) return md13[1]

  // Broward 10-digit folio: 50-41-08-001-0000 → 5041080010000
  const bw10 = upper.match(/\b(\d{2}-\d{2}-\d{2}-\d{3}-\d{4})\b/)
  if (bw10) return bw10[1].replace(/[^0-9]/g, '')

  return null
}

// ─── Resolution result ────────────────────────────────────────────────────────

export interface ResolutionResult {
  folio_number:     string | null   // null = could not resolve; record stored for manual review
  property_address: string | null   // normalised address used for lookup
  owner_name:       string | null   // from PA if available
  resolution_method: 'legal_extract' | 'gis_lookup' | 'reapi_lookup' | 'unresolved'
}

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve an ORRecord to a verified folio_number by the best available method.
 *
 * This function does NOT throw — it always returns a ResolutionResult.
 * If resolution fails, `folio_number` will be null and the record is
 * stored in the DB with is_pre_foreclosure=true for manual review.
 */
export async function resolveCourtRecordToFolio(
  record: ORRecord
): Promise<ResolutionResult> {
  // ── Strategy 1: Extract folio from legal description ─────────────────────
  const legalFolio = extractFolioFromLegal(record.legal_description)
  if (legalFolio) {
    console.log(`[Resolver] ${record.case_number}: folio extracted from legal desc → ${legalFolio}`)
    return {
      folio_number:      legalFolio,
      property_address:  null,
      owner_name:        null,
      resolution_method: 'legal_extract',
    }
  }

  // ── Strategy 2: Address lookup ────────────────────────────────────────────
  const rawAddr = record.property_address
  if (!rawAddr) {
    console.log(`[Resolver] ${record.case_number}: no address or legal desc — unresolved`)
    return { folio_number: null, property_address: null, owner_name: null, resolution_method: 'unresolved' }
  }

  const normAddr = normalizeCourtAddress(rawAddr)

  switch (record.county) {
    // Miami-Dade: use the free GIS parcel layer (no API key needed)
    case 'miami-dade': {
      try {
        const result = await findFolioByAddressGIS(normAddr)
        if (result) {
          console.log(`[Resolver] ${record.case_number}: GIS lookup → ${result.folio}`)
          return {
            folio_number:      result.folio,
            property_address:  normAddr,
            owner_name:        null,
            resolution_method: 'gis_lookup',
          }
        }
      } catch (err) {
        console.warn(`[Resolver] GIS lookup failed for ${record.case_number}:`, err)
      }
      break
    }

    // Broward / Palm Beach: use REAPI via background_operations pool
    case 'broward':
    case 'palm-beach': {
      const outcome = await getPropertyDetailByAddress(normAddr, record.county, BACKGROUND_CONTEXT)
      if (outcome.outcome === 'success' && outcome.data?.folio) {
        console.log(`[Resolver] ${record.case_number}: REAPI lookup → ${outcome.data.folio}`)
        return {
          folio_number:      outcome.data.folio,
          property_address:  normAddr,
          owner_name:        outcome.data.owner_name,
          resolution_method: 'reapi_lookup',
        }
      }
      if (outcome.outcome === 'blocked') {
        const tag = outcome.error_code === 'pool_exhausted' ? 'background_paused_by_budget' : outcome.error_code
        console.warn(`[Resolver] REAPI blocked for ${record.case_number}: ${tag}`)
      } else if (outcome.outcome === 'provider_failed') {
        console.warn(`[Resolver] REAPI failed for ${record.case_number}:`, outcome.error)
      }
      break
    }
  }

  console.log(`[Resolver] ${record.case_number}: address lookup failed for "${normAddr}" — unresolved`)
  return {
    folio_number:      null,
    property_address:  normAddr,
    owner_name:        null,
    resolution_method: 'unresolved',
  }
}
