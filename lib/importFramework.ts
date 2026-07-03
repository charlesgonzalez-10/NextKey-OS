/**
 * Import Framework — reusable parsing + normalization layer for lead imports.
 *
 * Supports CSV, TSV (auto-detected delimiter).
 * Column mapping is caller-supplied; this file handles parsing + normalization.
 */
import Papa from 'papaparse'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RawRow {
  [header: string]: string
}

export interface ParseResult {
  headers: string[]
  rows:    RawRow[]
  errors:  string[]
}

/** The canonical lead fields we can import into */
export type LeadField =
  | 'folio_number'
  | 'property_address'
  | 'city'
  | 'state'
  | 'zip'
  | 'county'
  | 'owner_name'
  | 'legal_description'
  | 'last_sale_date'
  | 'surplus_funds_amount'
  | 'foreclosure_amount'
  | 'case_number'
  | 'plaintiff'
  | 'file_date'
  | 'property_type'
  | 'beds'
  | 'baths'
  | 'sqft'
  | 'year_built'
  | 'market_value'
  | 'assessed_value'
  | 'tax_amount'
  | 'mailing_address'
  | 'phone_1'
  | 'skip'

export const LEAD_FIELD_LABELS: Record<LeadField, string> = {
  folio_number:         'Folio / Parcel ID',
  property_address:     'Property Address',
  city:                 'City',
  state:                'State',
  zip:                  'ZIP Code',
  county:               'County',
  owner_name:           'Owner Name',
  legal_description:    'Legal Description',
  last_sale_date:       'Sale Date',
  surplus_funds_amount: 'Surplus / Balance',
  foreclosure_amount:   'Foreclosure Amount',
  case_number:          'Case Number',
  plaintiff:            'Plaintiff',
  file_date:            'File Date',
  property_type:        'Property Type',
  beds:                 'Bedrooms',
  baths:                'Bathrooms',
  sqft:                 'Sq Ft',
  year_built:           'Year Built',
  market_value:         'Market Value',
  assessed_value:       'Assessed Value',
  tax_amount:           'Tax Amount',
  mailing_address:      'Mailing Address',
  phone_1:              'Phone',
  skip:                 '— Skip this column —',
}

/** Column name patterns → field auto-detection */
const AUTO_DETECT: Array<{ patterns: RegExp[]; field: LeadField }> = [
  { patterns: [/folio/i, /parcel/i, /apn/i, /tax.?deed.?num/i],                                                  field: 'folio_number' },
  { patterns: [/prop.*addr/i, /situs/i, /property.?addr/i, /site.?addr/i],                                       field: 'property_address' },
  { patterns: [/^city$/i, /prop.*city/i],                                                                          field: 'city' },
  { patterns: [/^state$/i, /^st$/i],                                                                               field: 'state' },
  { patterns: [/^zip/i, /postal/i],                                                                                field: 'zip' },
  { patterns: [/^county$/i],                                                                                        field: 'county' },
  { patterns: [/owner/i, /mortgagor/i, /taxpayer/i, /property.?owner/i],                                          field: 'owner_name' },
  { patterns: [/legal/i, /description/i],                                                                           field: 'legal_description' },
  { patterns: [/sale.?date/i, /last.?sale/i, /sold.?date/i],                                                      field: 'last_sale_date' },
  { patterns: [/surplus/i, /balance/i, /unclaimed/i, /excess/i],                                                  field: 'surplus_funds_amount' },
  { patterns: [/foreclosure.?amount/i, /judgment/i, /lien.?amount/i],                                             field: 'foreclosure_amount' },
  { patterns: [/case.?num/i, /case.?no/i, /file.?num/i],                                                          field: 'case_number' },
  { patterns: [/plaintiff/i, /lender/i],                                                                            field: 'plaintiff' },
  { patterns: [/file.?date/i, /filed/i, /recorded/i],                                                              field: 'file_date' },
  { patterns: [/prop.*type/i, /property.?type/i, /use.?code/i],                                                   field: 'property_type' },
  { patterns: [/bed/i, /^br$/i],                                                                                    field: 'beds' },
  { patterns: [/bath/i, /^ba$/i],                                                                                   field: 'baths' },
  { patterns: [/sqft/i, /sq.?ft/i, /living.?area/i, /floor.?area/i],                                              field: 'sqft' },
  { patterns: [/year.?built/i, /yr.?built/i, /^yb$/i],                                                            field: 'year_built' },
  { patterns: [/market.?val/i, /just.?val/i, /appraised/i],                                                       field: 'market_value' },
  { patterns: [/assessed/i, /taxable/i],                                                                            field: 'assessed_value' },
  { patterns: [/tax.?amount/i, /annual.?tax/i, /^taxes$/i],                                                       field: 'tax_amount' },
  { patterns: [/mailing/i, /mail.*addr/i],                                                                          field: 'mailing_address' },
  { patterns: [/phone/i, /tel/i, /^ph$/i],                                                                         field: 'phone_1' },
]

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse CSV or TSV text (delimiter auto-detected) into headers + rows.
 * Returns up to 2000 rows; caller batches for import.
 */
export function parseFile(text: string): ParseResult {
  const errors: string[] = []

  // Auto-detect delimiter: count tabs vs commas in first line
  const firstLine = text.split('\n')[0] ?? ''
  const tabCount   = (firstLine.match(/\t/g) ?? []).length
  const commaCount = (firstLine.match(/,/g)  ?? []).length
  const delimiter  = tabCount > commaCount ? '\t' : ','

  const result = Papa.parse<RawRow>(text.trim(), {
    header:        true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  if (result.errors.length) {
    result.errors.slice(0, 5).forEach(e => errors.push(`Row ${e.row ?? '?'}: ${e.message}`))
  }

  const rows    = (result.data as RawRow[]).slice(0, 2000)
  const headers = result.meta.fields ?? []

  return { headers, rows, errors }
}

// ── Auto-detect column mapping ─────────────────────────────────────────────

/** Given file headers, return best-guess mapping header → LeadField */
export function autoDetectMapping(headers: string[]): Record<string, LeadField> {
  const mapping: Record<string, LeadField> = {}
  const used = new Set<LeadField>()

  for (const header of headers) {
    for (const { patterns, field } of AUTO_DETECT) {
      if (used.has(field)) continue
      if (patterns.some(p => p.test(header))) {
        mapping[header] = field
        used.add(field)
        break
      }
    }
    if (!mapping[header]) mapping[header] = 'skip'
  }

  return mapping
}

// ── Normalizers ───────────────────────────────────────────────────────────────

export function normalizeAddress(raw: string): {
  property_address: string; city: string; state: string; zip: string
} {
  const ROAD_SUFFIXES = new Set([
    'AVE','BLVD','ST','RD','DR','LN','CT','PL','TER','WAY','CIR',
    'PKWY','HWY','PATH','LOOP','RUN','TRL','WALK','PASS','XING',
    'CV','GRV','HOLW','KNL','LNDG','MDWS','MNR','MT','OPAS','ORCH',
    'PARK','PIKE','PT','ROW','SHL','SHLS','SPG','SPGS','SQ','STA',
  ])
  const DIR_SUFFIXES = new Set(['N','S','E','W','NE','NW','SE','SW'])

  const stripped = raw.replace(/^\d+\s+/, '').trim()
  const zipMatch = stripped.match(/\b(\d{5})$/)
  const zip      = zipMatch?.[1] ?? ''
  let rest       = zip ? stripped.slice(0, stripped.lastIndexOf(zip)).trim() : stripped
  const stateMatch = rest.match(/\b([A-Z]{2})$/)
  const state      = stateMatch?.[1] ?? 'FL'
  rest = stateMatch ? rest.slice(0, rest.lastIndexOf(stateMatch[0])).trim() : rest

  const tokens = rest.split(/\s+/).filter(Boolean)
  let houseIdx = -1
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(tokens[i])) {
      const ahead = tokens.slice(i + 1, i + 6)
      if (ahead.some(t => ROAD_SUFFIXES.has(t))) { houseIdx = i; break }
    }
  }
  if (houseIdx < 0) return { property_address: rest, city: '', state, zip }

  let lastSuffixIdx = houseIdx
  for (let i = houseIdx; i < tokens.length; i++) {
    if (ROAD_SUFFIXES.has(tokens[i]) || DIR_SUFFIXES.has(tokens[i])) lastSuffixIdx = i
  }
  return {
    property_address: tokens.slice(houseIdx, lastSuffixIdx + 1).join(' '),
    city:             tokens.slice(lastSuffixIdx + 1).join(' '),
    state,
    zip,
  }
}

export function normalizeMoney(raw: string): number | null {
  const n = parseFloat((raw ?? '').replace(/[$,\s]/g, ''))
  return isNaN(n) ? null : n
}

export function normalizeDate(raw: string): string | null {
  if (!raw?.trim()) return null
  const d = new Date(raw.trim())
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  // MM/DD/YYYY
  const m = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    const d2   = new Date(`${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`)
    if (!isNaN(d2.getTime())) return d2.toISOString().split('T')[0]
  }
  return null
}

export function normalizeInt(raw: string): number | null {
  const n = parseInt((raw ?? '').replace(/[,\s]/g, ''), 10)
  return isNaN(n) ? null : n
}

// ── Row → NormalizedLead ──────────────────────────────────────────────────────

export interface NormalizedLead {
  folio_number?:         string | null
  property_address:      string
  city:                  string
  state:                 string
  zip:                   string
  county?:               string | null
  owner_name?:           string | null
  legal_description?:    string | null
  last_sale_date?:       string | null
  surplus_funds_amount?: number | null
  foreclosure_amount?:   number | null
  case_number?:          string | null
  plaintiff?:            string | null
  file_date?:            string | null
  property_type?:        string | null
  beds?:                 number | null
  baths?:                number | null
  living_area?:          number | null
  year_built?:           number | null
  market_value?:         number | null
  assessed_value?:       number | null
  tax_amount?:           number | null
  mailing_address?:      string | null
  phone_1?:              string | null
  _raw?:                 RawRow
  _warnings?:            string[]
}

/**
 * Convert a raw row + column mapping into a NormalizedLead.
 * Handles the case where property_address needs to be parsed from a single combined field.
 */
export function normalizeRow(
  row: RawRow,
  mapping: Record<string, LeadField>,
  defaults: { county?: string; state?: string } = {}
): NormalizedLead | null {
  const get = (field: LeadField): string => {
    for (const [col, f] of Object.entries(mapping)) {
      if (f === field && row[col]?.trim()) return row[col].trim()
    }
    return ''
  }

  const warnings: string[] = []

  // Address — if property_address is mapped directly or must be parsed from combined field
  let property_address = get('property_address')
  let city             = get('city')
  let state            = get('state') || defaults.state || 'FL'
  let zip              = get('zip')

  // If address includes city/state/zip (common in county exports), parse it
  if (property_address && (!city || !zip)) {
    const parsed = normalizeAddress(property_address)
    if (!city) city = parsed.city
    if (!zip)  zip  = parsed.zip
    if (!state || state === 'FL') state = parsed.state
    property_address = parsed.property_address
  }

  if (!property_address) {
    // Nothing usable
    return null
  }

  const folio = get('folio_number') || null

  return {
    folio_number:         folio,
    property_address,
    city,
    state,
    zip,
    county:               get('county') || defaults.county || null,
    owner_name:           get('owner_name') || null,
    legal_description:    get('legal_description') || null,
    last_sale_date:       normalizeDate(get('last_sale_date')),
    surplus_funds_amount: normalizeMoney(get('surplus_funds_amount')),
    foreclosure_amount:   normalizeMoney(get('foreclosure_amount')),
    case_number:          get('case_number') || null,
    plaintiff:            get('plaintiff') || null,
    file_date:            normalizeDate(get('file_date')),
    property_type:        get('property_type') || null,
    beds:                 normalizeInt(get('beds')),
    baths:                normalizeInt(get('baths')),
    living_area:          normalizeInt(get('sqft')),
    year_built:           normalizeInt(get('year_built')),
    market_value:         normalizeMoney(get('market_value')),
    assessed_value:       normalizeMoney(get('assessed_value')),
    tax_amount:           normalizeMoney(get('tax_amount')),
    mailing_address:      get('mailing_address') || null,
    phone_1:              get('phone_1') || null,
    _raw:                 row,
    _warnings:            warnings,
  }
}

/**
 * Generate a stable folio-like key for rows that don't have a folio number.
 * Uses address + owner name. Not a real folio — just a dedup key.
 */
export function generateFolioKey(lead: NormalizedLead): string {
  const addr  = `${lead.property_address} ${lead.city} ${lead.state} ${lead.zip}`
    .toUpperCase().replace(/[^A-Z0-9]/g, '')
  const owner = (lead.owner_name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
  return `AUTO-${addr.slice(0, 20)}-${owner}`
}
