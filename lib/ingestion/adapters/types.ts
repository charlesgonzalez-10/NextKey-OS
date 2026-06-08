/**
 * Shared types for the OR (Official Records) ingestion adapter layer.
 *
 * Each county adapter reads a different feed format (SFTP flat-file, REST API,
 * HTML portal) and normalises its output to the uniform ORRecord shape.
 * The engine (lib/ingestion/engine.ts) only works with ORRecord — it never
 * knows or cares which county adapter produced it.
 */

import type { County } from '@/lib/scrapers/types'

// ─── Normalised OR record ─────────────────────────────────────────────────────

// ─── Lead category ────────────────────────────────────────────────────────────

/**
 * Normalised category derived from the raw OR doc_type code.
 * This is the single field that drives which tab/flag a record lands in.
 */
export type LeadCategory =
  | 'lis_pendens'   // LP → Pre-Foreclosure
  | 'probate'       // PROB → Probate
  | 'tax_deed'      // TCD/TL → Tax Deed / Tax Lien
  | 'divorce'       // DOM → Divorce / Dissolution of Marriage
  | 'unknown'

/**
 * One OR filing extracted from a county index feed.
 *
 * Field notes:
 *  - `case_number`    : court docket / OR instrument CFN — the dedup key
 *  - `lead_category`  : derived category; drives DB flags & tab routing
 *  - `plaintiff`      : OR "grantor" — the lender / party filing the action
 *  - `defendant`      : OR "grantee" — the borrower / property owner
 *  - `consideration`  : lien / claim amount from the OR index (if present)
 *  - `property_address` / `legal_description`: optional; the resolver uses
 *    whichever is available to match a folio. Both may be absent from some feeds.
 */
export interface ORRecord {
  // Dedup key
  case_number:        string

  // Filing metadata
  recording_date:     string          // YYYY-MM-DD
  doc_type:           string          // raw code from feed: LP, PROB, DOM, TCD …
  lead_category:      LeadCategory    // normalised category

  // Parties
  plaintiff:          string          // grantor = lender / petitioner
  defendant:          string          // grantee = borrower / respondent

  // Property hints — populated when available, absent otherwise
  property_address?:  string
  legal_description?: string

  // Financial
  consideration?:     number          // lien / estate amount in $

  // Provenance
  county:             County
  source_file?:       string          // filename or API call that produced this record
  raw:                unknown         // original parsed row for audit / storage
}

// ─── Adapter contract ─────────────────────────────────────────────────────────

/**
 * Every county OR adapter must satisfy this interface.
 *
 * `fetchYesterdaysRecords()` is the only public method: it fetches the day-delta
 * for the previous calendar day, filters down to Lis Pendens doc types, and
 * returns a (possibly empty) array of normalised ORRecords.
 *
 * Implementations must be idempotent: calling the method twice on the same day
 * should return the same set of records (not doubled data).
 */
export interface CountyAdapter {
  readonly county: County
  fetchYesterdaysRecords(): Promise<ORRecord[]>
}

// ─── Doc type classification ──────────────────────────────────────────────────

/** Lis Pendens — Pre-Foreclosure */
export const LIS_PENDENS_DOC_TYPES = new Set([
  'LP', 'LIS', 'LISAM', 'LPAM', 'LISPENDENS',
  'LIS PENDENS', 'LIS-PENDENS', 'LISP', 'LPE',
  'NLIS',           // Notice of Lis Pendens
])

/** Probate — estate filings, letters of administration, notice to creditors */
export const PROBATE_DOC_TYPES = new Set([
  'PROB', 'PROBATE', 'PR',
  'NOA',            // Notice of Administration
  'NTC',            // Notice to Creditors (Broward probate variant)
  'PRBD',           // Probate Bond
  'PROBL',          // Probate Lien
  'LTOR',           // Letters of Administration / Testamentary
  'LTRS',           // Letters (generic)
])

/** Tax Deed / Tax Certificate — county tax deed sales */
export const TAX_DEED_DOC_TYPES = new Set([
  'TCD', 'TAXDEED', 'TAX DEED', 'TAX-DEED',
  'TCF', 'TCT',     // Tax Certificate
  'TL',             // Tax Lien
  'TAX LIEN', 'TAXLIEN',
  'TDOA',           // Tax Deed Overbid Application
])

/** Dissolution of Marriage — divorce with real property involvement */
export const DIVORCE_DOC_TYPES = new Set([
  'DOM', 'DOMP', 'DOMN', 'DISS',
  'DISSOLUTION', 'DISSOLUTION OF MARRIAGE',
  'DOM-RE',         // DOM with Real Estate
])

/** Master set — every doc type we want to ingest */
export const ALL_DISTRESS_DOC_TYPES = new Set([
  ...LIS_PENDENS_DOC_TYPES,
  ...PROBATE_DOC_TYPES,
  ...TAX_DEED_DOC_TYPES,
  ...DIVORCE_DOC_TYPES,
])

/** Normalise a raw doc type string before set lookup */
function norm(docType: string): string {
  return docType.trim().toUpperCase().replace(/\s+/g, ' ')
}

export function isLisPendens(docType: string): boolean {
  return LIS_PENDENS_DOC_TYPES.has(norm(docType))
}

export function isDistressType(docType: string): boolean {
  return ALL_DISTRESS_DOC_TYPES.has(norm(docType))
}

/**
 * Classify a raw OR doc type code into a LeadCategory.
 * Returns 'unknown' if the code is not in any known set.
 */
export function classifyDocType(docType: string): LeadCategory {
  const n = norm(docType)
  if (LIS_PENDENS_DOC_TYPES.has(n)) return 'lis_pendens'
  if (PROBATE_DOC_TYPES.has(n))     return 'probate'
  if (TAX_DEED_DOC_TYPES.has(n))    return 'tax_deed'
  if (DIVORCE_DOC_TYPES.has(n))     return 'divorce'
  return 'unknown'
}

// ─── Adapter result envelope ──────────────────────────────────────────────────

export interface AdapterResult {
  county:    County
  records:   ORRecord[]
  fetched:   number        // rows pulled from feed before LP filter
  filtered:  number        // LP rows after filter = records.length
  source:    string        // human-readable description of the feed / file
  error?:    string        // set if the adapter threw; records will be []
}
