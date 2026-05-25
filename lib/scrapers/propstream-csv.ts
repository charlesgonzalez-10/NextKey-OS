/**
 * PropStream CSV Export Parser
 *
 * Parses PropStream pre-foreclosure / lis pendens CSV exports.
 * PropStream exports are standard comma-separated with a header row.
 *
 * Handles flexible column naming — PropStream has changed their export
 * format several times, so we try all known aliases for each field.
 *
 * Returns EnrichedLead[] so the import route can skip the Property
 * Appraiser lookup (PropStream already includes valuations and equity).
 */

import type { EnrichedLead, County, EquityTier } from './types'
import { parseDate, today } from './utils'

// ─── Column alias maps ────────────────────────────────────────────────────────
// Each array: [primary_alias, ...fallbacks] — all matched case-insensitively

const COL = {
  address:       ['property address', 'address', 'prop address', 'street address', 'property street'],
  city:          ['property city', 'city', 'prop city', 'mailing city'],
  state:         ['property state', 'state', 'prop state'],
  zip:           ['property zip', 'zip', 'zip code', 'postal code', 'prop zip', 'property zip code'],
  county:        ['county', 'property county', 'prop county', 'county name'],
  apn:           ['apn', 'parcel number', 'parcel id', 'folio', 'folio number', 'folio #', 'tax id', 'parcel #', 'assessors parcel number'],
  owner:         ['owner name', 'owner', 'owner 1', 'full name', 'name', 'mortgagor', 'borrower'],
  owner_first:   ['owner 1 first name', 'first name', 'owner first', 'borrower first name'],
  owner_last:    ['owner 1 last name', 'last name', 'owner last', 'borrower last name'],
  plaintiff:     ['plaintiff', 'foreclosing lender', 'foreclosing bank', 'lender filing', 'filing party'],
  lender:        ['first mortgage lender', 'lender', 'mortgage lender', 'bank name', 'original lender'],
  case_number:   ['pre-foreclosure case number', 'case number', 'case #', 'case no', 'instrument number', 'filing number', 'doc number', 'document number', 'lis pendens number'],
  file_date:     ['pre-foreclosure filing date', 'filing date', 'recorded date', 'recording date', 'file date', 'lp date', 'lis pendens date', 'pre foreclosure date', 'notice date'],
  mortgage_date: ['first mortgage date', 'mortgage date', 'loan date', 'origination date', 'loan origination date'],
  loan_balance:  ['open mortgage balance', 'loan balance', 'mortgage balance', 'open balance', 'balance', 'loan amount', 'mortgage amount', 'foreclosure amount', 'estimated balance'],
  beds:          ['beds', 'bedrooms', 'bd', 'br', 'bed', 'number of bedrooms'],
  baths:         ['baths', 'bathrooms', 'ba', 'full baths', 'bath', 'number of bathrooms'],
  sqft:          ['building sq ft', 'sqft', 'sq ft', 'living area', 'building sqft', 'liveable sq ft', 'living sq ft', 'heated sq ft', 'total sq ft', 'square feet'],
  lot_sqft:      ['lot sq ft', 'lot sqft', 'lot size', 'land sq ft', 'land size', 'lot square feet'],
  year_built:    ['year built', 'yr built', 'built', 'year built/effective'],
  property_type: ['property type', 'prop type', 'land use', 'use type', 'use code description'],
  market_value:  ['estimated value', 'market value', 'avm', 'estimated market value', 'estimated price', 'value', 'prop value', 'property value'],
  assessed_value:['assessed value', 'total assessed value', 'assessed', 'total assessed'],
  last_sale_date:['last sale date', 'last sold date', 'sale date', 'sold date', 'prior sale date'],
  sold_price:    ['last sale price', 'sale price', 'sold price', 'last sold price', 'prior sale price'],
  equity_amt:    ['equity', 'equity amount', 'equity ($)', 'equity value', 'estimated equity'],
  equity_pct:    ['equity percent', 'equity %', 'equity percentage', '% equity', 'equity ratio'],
  homestead:     ['homestead', 'homestead exempt', 'owner occupied', 'homestead exemption', 'is homestead'],
  vacant:        ['vacant', 'vacancy', 'is vacant', 'vacancy status'],
  phone_1:       ['phone 1', 'phone1', 'phone', 'cell phone', 'mobile', 'primary phone', 'mobile phone'],
  phone_2:       ['phone 2', 'phone2', 'secondary phone', 'home phone', 'landline'],
  phone_3:       ['phone 3', 'phone3', 'alt phone', 'alternate phone'],
  phone_4:       ['phone 4', 'phone4'],
  phone_5:       ['phone 5', 'phone5'],
} as const

type ColKey = keyof typeof COL

// ─── County normaliser ────────────────────────────────────────────────────────

function normaliseCounty(raw: string): County | null {
  const s = raw.toLowerCase().replace(/[-\s]+/g, '')
  if (s.includes('miamidade') || s.includes('miami') || s.includes('dade')) return 'miami-dade'
  if (s.includes('broward')) return 'broward'
  if (s.includes('palmbeach') || s.includes('palm')) return 'palm-beach'
  return null
}

// ─── Minimal CSV parser (handles quoted fields + embedded commas) ─────────────

function parseCSV(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const ch   = content[i]
    const next = content[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++ }
      else if (ch === '"')             inQuotes = false
      else                             cell += ch
    } else {
      if      (ch === '"') inQuotes = true
      else if (ch === ',') { row.push(cell.trim()); cell = '' }
      else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
      else if (ch === '\r') { /* skip \r */ }
      else                  cell += ch
    }
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows.filter(r => r.some(c => c))
}

// Build a map from ColKey → column index using the header row
function buildColIndex(headers: string[]): Map<ColKey, number> {
  const idx  = new Map<ColKey, number>()
  const lower = headers.map(h => h.toLowerCase().trim())

  for (const key of Object.keys(COL) as ColKey[]) {
    for (const alias of COL[key]) {
      const col = lower.indexOf(alias)
      if (col !== -1) { idx.set(key, col); break }
    }
  }
  return idx
}

function get(row: string[], idx: Map<ColKey, number>, key: ColKey): string {
  const col = idx.get(key)
  return col !== undefined ? (row[col] || '').trim() : ''
}

function num(v: string): number | undefined {
  if (!v) return undefined
  const n = parseFloat(v.replace(/[$,%\s]/g, '').replace(/,/g, ''))
  return isNaN(n) ? undefined : n
}

function parseBool(v: string): boolean {
  return ['yes', 'true', '1', 'y', 'x', 'checked'].includes(v.toLowerCase().trim())
}

function equityTier(pct: number | undefined): EquityTier {
  if (pct === undefined) return 'None'
  if (pct >= 50) return 'High'
  if (pct >= 25) return 'Medium'
  if (pct >  0)  return 'Low'
  return 'None'
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface PropStreamParseResult {
  leads:      EnrichedLead[]
  total_rows: number
  skipped:    number
  lp_count:   number
}

/**
 * Parse a PropStream pre-foreclosure CSV export.
 *
 * @param content      Raw file text
 * @param defaultCounty  Fallback county if the CSV has no County column (or
 *                       an unrecognised value).  When null, rows with no
 *                       recognisable county are skipped.
 */
export function parsePropStreamCSV(
  content: string,
  defaultCounty: County | null = null,
): PropStreamParseResult {
  const rows = parseCSV(content)
  if (rows.length < 2) {
    return { leads: [], total_rows: 0, skipped: 0, lp_count: 0 }
  }

  const headers  = rows[0]
  const idx      = buildColIndex(headers)
  const dataRows = rows.slice(1)

  const leads: EnrichedLead[] = []
  let skipped = 0

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    if (row.every(c => !c)) { skipped++; continue }

    // Resolve county
    const countyRaw = get(row, idx, 'county')
    const county    = normaliseCounty(countyRaw) || defaultCounty
    if (!county) { skipped++; continue }

    // Build owner name
    let ownerName = get(row, idx, 'owner')
    if (!ownerName) {
      const first = get(row, idx, 'owner_first')
      const last  = get(row, idx, 'owner_last')
      ownerName   = [first, last].filter(Boolean).join(' ')
    }

    const caseNum   = get(row, idx, 'case_number') || `PS-${county.slice(0, 2).toUpperCase()}-${i + 1}`
    const fileDate  = parseDate(get(row, idx, 'file_date')) || today()
    const plaintiff = get(row, idx, 'plaintiff') || get(row, idx, 'lender') || ''
    const lender    = get(row, idx, 'lender')    || plaintiff

    const loanBal   = num(get(row, idx, 'loan_balance'))
    const marketVal = num(get(row, idx, 'market_value'))
    const assessVal = num(get(row, idx, 'assessed_value'))
    const equityAmt = num(get(row, idx, 'equity_amt'))
    const equityPct = num(get(row, idx, 'equity_pct'))

    leads.push({
      // ── ClerkRecord ────────────────────────────────────────────────────────
      case_number:        caseNum,
      file_date:          fileDate,
      plaintiff,
      mortgagor:          ownerName,
      foreclosure_amount: loanBal || 0,
      lender_name:        lender || undefined,
      mortgage_date:      parseDate(get(row, idx, 'mortgage_date')) || undefined,
      foreclosure_type:   'P',
      multiple_liens:     false,
      property_address:   get(row, idx, 'address') || undefined,
      folio_number:       get(row, idx, 'apn')     || undefined,
      county,

      // ── Property detail (PropStream provides these — no PA lookup needed) ─
      owner_name:    ownerName || undefined,
      city:          get(row, idx, 'city')  || undefined,
      state:         get(row, idx, 'state') || 'FL',
      zip:           get(row, idx, 'zip')   || undefined,
      beds:          num(get(row, idx, 'beds')),
      baths:         num(get(row, idx, 'baths')),
      living_area:   num(get(row, idx, 'sqft')),
      lot_size:      num(get(row, idx, 'lot_sqft')),
      year_built:    num(get(row, idx, 'year_built')),
      property_type: get(row, idx, 'property_type') || undefined,
      homestead:     parseBool(get(row, idx, 'homestead')),
      vacant:        get(row, idx, 'vacant') ? parseBool(get(row, idx, 'vacant')) : undefined,
      last_sale_date:parseDate(get(row, idx, 'last_sale_date')) || undefined,
      sold_price:    num(get(row, idx, 'sold_price')),
      assessed_value:assessVal,
      market_value:  marketVal,

      // ── Equity (use PropStream's numbers when available) ──────────────────
      known_debt:           loanBal,
      equity_dollar_amount: equityAmt,
      equity_percentage:    equityPct,
      equity_tier:          equityTier(equityPct),

      // ── Phones (skip traced) ──────────────────────────────────────────────
      phone_1: get(row, idx, 'phone_1') || undefined,
      phone_2: get(row, idx, 'phone_2') || undefined,
      phone_3: get(row, idx, 'phone_3') || undefined,
      phone_4: get(row, idx, 'phone_4') || undefined,
      phone_5: get(row, idx, 'phone_5') || undefined,
    })
  }

  return {
    leads,
    total_rows: dataRows.length,
    skipped,
    lp_count:   leads.length,
  }
}
