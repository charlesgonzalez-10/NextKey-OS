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

/**
 * One Lis Pendens filing extracted from a county OR index feed.
 *
 * Field notes:
 *  - `case_number`  : court docket / OR instrument CFN — the dedup key
 *  - `plaintiff`    : OR "grantor" — the lender / party filing the action
 *  - `defendant`    : OR "grantee" — the borrower / property owner
 *  - `consideration`: lien / claim amount from the OR index (if present)
 *  - `property_address` / `legal_description`: optional; the resolver uses
 *    whichever is available to match a folio. Both may be absent from some feeds.
 */
export interface ORRecord {
  // Dedup key
  case_number:        string

  // Filing metadata
  recording_date:     string          // YYYY-MM-DD
  doc_type:           string          // raw code from feed: LP, LIS, LIS PENDENS …

  // Parties
  plaintiff:          string          // grantor = lender
  defendant:          string          // grantee = borrower / current owner

  // Property hints — populated when available, absent otherwise
  property_address?:  string
  legal_description?: string

  // Financial
  consideration?:     number          // lien amount in $

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

// ─── LP doc type guard ────────────────────────────────────────────────────────

/**
 * Normalised set of OR document type codes that represent a Lis Pendens filing
 * across all three county feeds. Broward and Palm Beach use short codes; the
 * Miami-Dade API uses "LP" exclusively.
 */
export const LIS_PENDENS_DOC_TYPES = new Set([
  'LP',
  'LIS',
  'LISAM',    // LP amendment
  'LPAM',     // LP amendment (Broward variant)
  'LISPENDENS',
  'LIS PENDENS',
  'LIS-PENDENS',
  'LISP',
  'LPE',      // LP extension
])

export function isLisPendens(docType: string): boolean {
  return LIS_PENDENS_DOC_TYPES.has(docType.trim().toUpperCase().replace(/\s+/g, ' '))
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
