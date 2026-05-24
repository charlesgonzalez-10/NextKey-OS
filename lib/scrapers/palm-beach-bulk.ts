/**
 * Palm Beach County Clerk — Bulk Index File Parser
 *
 * Palm Beach provides flat pipe-delimited Official Records index files.
 * Annual subscription: $40/year from mypalmbeachclerk.com.
 * Web scraping is explicitly prohibited and IP-blocked by the county.
 *
 * File format: pipe-delimited text, first row = column headers.
 * Common columns (order varies by file version):
 *   CFN | BOOK_TYPE | BOOK_NUMBER | PAGE_NUMBER | RECORD_DATE | DOC_TYPE |
 *   GRANTOR_NAME_1 | GRANTOR_NAME_2 | GRANTEE_NAME_1 | GRANTEE_NAME_2 |
 *   LEGAL_DESC_1 | LEGAL_DESC_2 | LEGAL_DESC_3 | LEGAL_DESC_4 |
 *   CONSIDERATION | FOLIO_NUMBER | ...
 *
 * This parser:
 *   1. Auto-detects delimiter (pipe, tab, or comma)
 *   2. Maps column headers via a flexible alias table
 *   3. Filters for LIS PENDENS variants only
 *   4. Returns ClerkRecord[] for the runner pipeline
 */

import type { ClerkRecord } from './types'
import { parseDate, today } from './utils'

// All known Palm Beach doc-type values that represent Lis Pendens
const LP_DOC_TYPES = new Set([
  'lis pendens', 'lispendens', 'lis-pendens', 'lp', 'l.p.',
  'lis pendens - residential', 'lis pendens - commercial',
  'lis pendens -residential', 'lis pendens -commercial',
])

// Flexible column name aliases → canonical field key
const COL_ALIASES: Record<string, string> = {
  // Instrument / case number
  cfn: 'cfn',
  control_file_number: 'cfn',
  instr_num: 'cfn',
  instrnum: 'cfn',
  instrument_number: 'cfn',
  instrumentnumber: 'cfn',
  inst_num: 'cfn',
  reception_no: 'cfn',

  // Recording date
  record_date: 'record_date',
  recording_date: 'record_date',
  rec_date: 'record_date',
  recorded_date: 'record_date',
  filed_date: 'record_date',
  file_date: 'record_date',
  date_recorded: 'record_date',

  // Document type
  doc_type: 'doc_type',
  document_type: 'doc_type',
  instr_type: 'doc_type',
  instrument_type: 'doc_type',
  type: 'doc_type',
  doctype: 'doc_type',

  // Grantor 1 (mortgagor / borrower / defendant)
  grantor_name_1: 'grantor_1',
  grantor_name1: 'grantor_1',
  grantor1: 'grantor_1',
  grantor_1: 'grantor_1',
  grantor: 'grantor_1',
  grantorname: 'grantor_1',
  party1_name: 'grantor_1',

  // Grantor 2
  grantor_name_2: 'grantor_2',
  grantor_name2: 'grantor_2',
  grantor2: 'grantor_2',
  grantor_2: 'grantor_2',
  party2_name: 'grantor_2',

  // Grantee 1 (lender / plaintiff)
  grantee_name_1: 'grantee_1',
  grantee_name1: 'grantee_1',
  grantee1: 'grantee_1',
  grantee_1: 'grantee_1',
  grantee: 'grantee_1',
  granteename: 'grantee_1',
  party3_name: 'grantee_1',

  // Grantee 2
  grantee_name_2: 'grantee_2',
  grantee_name2: 'grantee_2',
  grantee2: 'grantee_2',
  grantee_2: 'grantee_2',
  party4_name: 'grantee_2',

  // Consideration / foreclosure amount
  consideration: 'amount',
  amount: 'amount',
  mortgage_amount: 'amount',
  loan_amount: 'amount',
  face_amount: 'amount',

  // Folio / parcel number
  folio_num: 'folio',
  folio_number: 'folio',
  folio: 'folio',
  parcel_id: 'folio',
  parcel_no: 'folio',
  pcn: 'folio',
  property_id: 'folio',

  // Legal description
  legal_desc_1: 'legal',
  legal_desc1: 'legal',
  legal_description_1: 'legal',
  legal_desc: 'legal',
  legal_description: 'legal',
  legal: 'legal',

  // Book / page (used as case number fallback)
  book_number: 'book',
  book_num: 'book',
  book: 'book',
  page_number: 'page',
  page_num: 'page',
  page: 'page',
}

interface ParsedRow {
  cfn?: string
  record_date?: string
  doc_type?: string
  grantor_1?: string
  grantor_2?: string
  grantee_1?: string
  grantee_2?: string
  amount?: string
  folio?: string
  legal?: string
  book?: string
  page?: string
}

// ─── Delimiter Detection ──────────────────────────────────────────────────────

function detectDelimiter(headerLine: string): string {
  // Count occurrences of each candidate delimiter
  const counts: Record<string, number> = { '|': 0, '\t': 0, ',': 0 }
  for (const ch of headerLine) {
    if (ch in counts) counts[ch]++
  }
  // Prefer pipe > tab > comma
  if (counts['|'] >= 3)  return '|'
  if (counts['\t'] >= 3) return '\t'
  if (counts[','] >= 3)  return ','
  return '|'  // fallback
}

// ─── Line Parsing ─────────────────────────────────────────────────────────────

function parseLine(line: string, delimiter: string): string[] {
  if (delimiter === ',') {
    // CSV with optional double-quoted fields
    const fields: string[] = []
    let current = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        inQuote = !inQuote
      } else if (ch === ',' && !inQuote) {
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    fields.push(current.trim())
    return fields
  }
  // Pipe or tab — straightforward split
  return line.split(delimiter).map(f => f.trim())
}

// ─── Header Mapping ───────────────────────────────────────────────────────────

function buildColumnMap(headers: string[]): Map<number, string> {
  const map = new Map<number, string>()
  const usedCanonicals = new Set<string>()

  for (let i = 0; i < headers.length; i++) {
    // Normalize: lowercase, replace spaces/dashes with underscores, strip non-alnum
    const normalized = headers[i]
      .toLowerCase()
      .replace(/[\s\-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '')

    const canonical = COL_ALIASES[normalized]
    if (canonical && !usedCanonicals.has(canonical)) {
      map.set(i, canonical)
      usedCanonicals.add(canonical)
    }
  }
  return map
}

// ─── Main Parser ──────────────────────────────────────────────────────────────

/**
 * Parse raw Palm Beach bulk index file content into ClerkRecord[].
 * Only returns records with doc_type matching Lis Pendens variants.
 */
export function parsePalmBeachBulkFile(content: string): {
  records: ClerkRecord[]
  total_rows: number
  skipped_rows: number
  lp_count: number
} {
  const lines = content.split(/\r?\n/).filter(l => l.trim())

  if (lines.length < 2) {
    console.log('[palm-beach-bulk] File appears empty or has only one line')
    return { records: [], total_rows: 0, skipped_rows: 0, lp_count: 0 }
  }

  const delimiter   = detectDelimiter(lines[0])
  const headers     = parseLine(lines[0], delimiter)
  const colMap      = buildColumnMap(headers)
  const dataLines   = lines.length - 1

  const delimLabel  = delimiter === '\t' ? 'TAB' : delimiter === '|' ? 'PIPE' : 'CSV'
  console.log(`[palm-beach-bulk] Delimiter=${delimLabel}, Columns=${headers.length}, Data rows=${dataLines}`)
  console.log(`[palm-beach-bulk] Mapped columns: ${[...colMap.values()].join(', ')}`)

  // Warn if critical columns are missing
  const mappedSet = new Set(colMap.values())
  const critical = ['cfn', 'record_date', 'doc_type', 'grantor_1', 'grantee_1']
  const missing  = critical.filter(c => !mappedSet.has(c))
  if (missing.length > 0) {
    console.log(`[palm-beach-bulk] WARNING: Could not map columns: ${missing.join(', ')}`)
    console.log(`[palm-beach-bulk] Header row was: ${lines[0].slice(0, 200)}`)
  }

  const records: ClerkRecord[] = []
  let skipped = 0
  let lpCount = 0

  for (let i = 1; i < lines.length; i++) {
    const fields = parseLine(lines[i], delimiter)
    if (fields.length < 3) { skipped++; continue }

    // Map fields to canonical row object
    const row: ParsedRow = {}
    for (const [colIdx, canonical] of colMap) {
      const val = fields[colIdx]
      if (val !== undefined && val !== '') {
        (row as Record<string, string>)[canonical] = val
      }
    }

    // ── Filter: Lis Pendens only ──────────────────────────────────────────────
    const docType = (row.doc_type || '').toLowerCase().trim()
    const isLP    = LP_DOC_TYPES.has(docType) || docType.startsWith('lis pendens')
    if (!isLP) { skipped++; continue }
    lpCount++

    // ── Build case/instrument number ─────────────────────────────────────────
    const instrNum = (
      row.cfn?.trim() ||
      (row.book && row.page ? `${row.book}-${row.page}` : '') ||
      `PB-ROW-${i}`
    )

    // ── Parties ──────────────────────────────────────────────────────────────
    const grantor1   = (row.grantor_1 || '').trim()
    const grantor2   = (row.grantor_2 || '').trim()
    const mortgagor  = [grantor1, grantor2].filter(Boolean).join('; ') || 'UNKNOWN'

    const grantee1   = (row.grantee_1 || '').trim()
    const grantee2   = (row.grantee_2 || '').trim()
    const plaintiff  = [grantee1, grantee2].filter(Boolean).join('; ') || 'UNKNOWN'

    // ── Amount ───────────────────────────────────────────────────────────────
    const amount = parseFloat((row.amount || '0').replace(/[$,\s]/g, '')) || 0

    // ── Date ─────────────────────────────────────────────────────────────────
    const fileDate = parseDate(row.record_date || '') || today()

    records.push({
      case_number:        instrNum,
      file_date:          fileDate,
      plaintiff,
      mortgagor,
      foreclosure_amount: amount,
      lender_name:        plaintiff !== 'UNKNOWN' ? plaintiff : undefined,
      foreclosure_type:   'P' as const,
      multiple_liens:     false,
      folio_number:       row.folio?.trim() || undefined,
      legal_description:  row.legal?.trim() || undefined,
      county:             'palm-beach' as const,
    })
  }

  console.log(`[palm-beach-bulk] ${lpCount} lis pendens found, ${skipped} rows skipped out of ${dataLines} total`)
  return {
    records,
    total_rows:  dataLines,
    skipped_rows: skipped,
    lp_count:    lpCount,
  }
}
