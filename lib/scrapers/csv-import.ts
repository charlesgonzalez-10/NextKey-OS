/**
 * REIFax CSV Import
 * Maps REIFax column names → NextKey OS scraper_leads fields
 * Handles flexible/inconsistent column naming
 */

import Papa from 'papaparse'
import type { EnrichedLead, County, EquityTier } from './types'
import { detectEntityType, calcEquityTier, parseMoney, parseDate, normalizePhone } from './utils'

// Column name aliases — maps any REIFax variation to our field name
const COLUMN_MAP: Record<string, string> = {
  // Property address
  'property address': 'property_address',
  'address': 'property_address',
  'site address': 'property_address',
  'prop address': 'property_address',
  // City
  'city': 'city',
  'property city': 'city',
  // State
  'state': 'state',
  // Zip
  'zip': 'zip',
  'zip code': 'zip',
  'postal code': 'zip',
  // Owner
  'owner name': 'owner_name',
  'owner': 'owner_name',
  'property owner': 'owner_name',
  'mortgagor': 'mortgagor',
  'borrower': 'mortgagor',
  'defendant': 'mortgagor',
  // Case
  'case number': 'case_number',
  'case #': 'case_number',
  'case no': 'case_number',
  // Filing
  'file date': 'file_date',
  'filing date': 'file_date',
  'date filed': 'file_date',
  'recording date': 'file_date',
  // Plaintiff / Lender
  'plaintiff': 'plaintiff',
  'lender': 'lender_name',
  'lender name': 'lender_name',
  'foreclosing lender': 'lender_name',
  // Foreclosure amount
  'foreclosure amount': 'foreclosure_amount',
  'mortgage amount': 'foreclosure_amount',
  'loan amount': 'foreclosure_amount',
  'amount': 'foreclosure_amount',
  'default amount': 'foreclosure_amount',
  // Folio
  'folio': 'folio_number',
  'folio number': 'folio_number',
  'folio #': 'folio_number',
  'parcel id': 'folio_number',
  'parcel number': 'folio_number',
  'apn': 'folio_number',
  // Property details
  'beds': 'beds',
  'bedrooms': 'beds',
  'bd': 'beds',
  'baths': 'baths',
  'bathrooms': 'baths',
  'ba': 'baths',
  'pool': 'pool',
  'year built': 'year_built',
  'yr built': 'year_built',
  'living area': 'living_area',
  'living sq ft': 'living_area',
  'sqft': 'living_area',
  'sq ft': 'living_area',
  'gross area': 'gross_area',
  'lot size': 'lot_size',
  'subdivision': 'subdivision_name',
  'subdivision name': 'subdivision_name',
  'sub name': 'subdivision_name',
  'zoning': 'zoning',
  'property type': 'property_type',
  'type': 'property_type',
  // Values
  'assessed value': 'assessed_value',
  'just value': 'assessed_value',
  'market value': 'market_value',
  'land value': 'land_value',
  'building value': 'build_value',
  'improvement value': 'build_value',
  'taxable value': 'tax_value',
  'appraised value': 'assessed_value',
  'sale price': 'sold_price',
  'last sale price': 'sold_price',
  'sold price': 'sold_price',
  'last sale date': 'last_sale_date',
  'sale date': 'last_sale_date',
  // Equity
  'equity': 'equity_dollar_amount',
  'equity amount': 'equity_dollar_amount',
  'equity %': 'equity_percentage',
  'equity percent': 'equity_percentage',
  'equity tier': 'equity_tier',
  // Homestead / Vacant
  'homestead': 'homestead',
  'owner occupied': 'homestead',
  'vacant': 'vacant',
  // Phones
  'phone': 'phone_1',
  'phone 1': 'phone_1',
  'phone1': 'phone_1',
  'cell': 'phone_1',
  'phone 2': 'phone_2',
  'phone2': 'phone_2',
  'phone 3': 'phone_3',
  'phone3': 'phone_3',
  'phone 4': 'phone_4',
  'phone4': 'phone_4',
  'phone 5': 'phone_5',
  'phone5': 'phone_5',
  // County
  'county': 'county',
  // Type
  'foreclosure type': 'foreclosure_type',
  'type code': 'foreclosure_type',
  // Auction
  'auction date': 'auction_date',
  'sale date (auction)': 'auction_date',
  'auction amount': 'auction_amount',
  'auction price': 'auction_amount',
  // Liens
  'multiple liens': 'multiple_liens',
  'liens': 'multiple_liens',
}

function normalizeKey(key: string): string {
  return key.toLowerCase().trim().replace(/[_-]+/g, ' ')
}

function mapColumnName(header: string): string | null {
  const normalized = normalizeKey(header)
  return COLUMN_MAP[normalized] || null
}

function mapCounty(val: string): County {
  const v = val.toLowerCase()
  if (v.includes('miami') || v.includes('dade') || v.includes('m-d')) return 'miami-dade'
  if (v.includes('broward') || v.includes('bwd')) return 'broward'
  if (v.includes('palm') || v.includes('pb') || v.includes('pbc')) return 'palm-beach'
  return 'miami-dade'  // default
}

function parseBool(val: string): boolean {
  if (!val) return false
  const v = val.toLowerCase().trim()
  return v === 'y' || v === 'yes' || v === '1' || v === 'true' || v === 'x'
}

export interface CSVImportResult {
  total: number
  created: number
  skipped: number
  errors: number
  skip_log: { row: number; reason: string; address?: string }[]
  error_log: { row: number; reason: string }[]
  leads: EnrichedLead[]
}

export function parseREIFaxCSV(csvText: string): CSVImportResult {
  const result: CSVImportResult = {
    total: 0,
    created: 0,
    skipped: 0,
    errors: 0,
    skip_log: [],
    error_log: [],
    leads: [],
  }

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  result.total = parsed.data.length

  // Build column mapping from actual CSV headers
  const headerMap: Record<string, string> = {}
  if (parsed.data.length > 0) {
    for (const header of Object.keys(parsed.data[0])) {
      const mapped = mapColumnName(header)
      if (mapped) headerMap[header] = mapped
    }
  }

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i]
    const rowNum = i + 2  // 1-indexed + header row

    try {
      // Map columns
      const mapped: Record<string, string> = {}
      for (const [csvCol, ourField] of Object.entries(headerMap)) {
        if (row[csvCol] !== undefined) mapped[ourField] = row[csvCol]
      }

      // Validate minimum required fields
      const address = mapped.property_address || ''
      const owner   = mapped.owner_name || mapped.mortgagor || ''
      if (!address && !owner) {
        result.skipped++
        result.skip_log.push({ row: rowNum, reason: 'Missing address and owner name' })
        continue
      }

      // Build the lead
      const folio = mapped.folio_number?.replace(/[-\s]/g, '') || undefined
      const caseNum = mapped.case_number || undefined

      const foreclosureAmount = parseMoney(mapped.foreclosure_amount) || 0
      const assessedValue = parseMoney(mapped.assessed_value) || 0
      const equityDollar = assessedValue - foreclosureAmount
      const equityPct = assessedValue > 0 ? (equityDollar / assessedValue) * 100 : 0

      const lead: EnrichedLead = {
        county: mapped.county ? mapCounty(mapped.county) : 'miami-dade',
        case_number: caseNum || `CSV-${Date.now()}-${i}`,
        file_date: parseDate(mapped.file_date) || new Date().toISOString().split('T')[0],
        plaintiff: mapped.plaintiff || mapped.lender_name || '',
        mortgagor: mapped.mortgagor || owner,
        foreclosure_amount: foreclosureAmount,
        lender_name: mapped.lender_name || mapped.plaintiff || '',
        foreclosure_type: (mapped.foreclosure_type as 'P' | 'A') || 'P',
        auction_date: parseDate(mapped.auction_date),
        auction_amount: parseMoney(mapped.auction_amount),
        multiple_liens: parseBool(mapped.multiple_liens),
        folio_number: folio,
        owner_name: owner,
        property_address: address,
        city: mapped.city || '',
        state: 'FL',
        zip: mapped.zip || '',
        beds: parseFloat(mapped.beds || '0') || undefined,
        baths: parseFloat(mapped.baths || '0') || undefined,
        pool: parseBool(mapped.pool),
        gross_area: parseMoney(mapped.gross_area),
        living_area: parseMoney(mapped.living_area),
        lot_size: parseMoney(mapped.lot_size),
        zoning: mapped.zoning || '',
        subdivision_name: mapped.subdivision_name || '',
        property_type: mapped.property_type || '',
        year_built: parseInt(mapped.year_built || '0') || undefined,
        homestead: parseBool(mapped.homestead),
        vacant: parseBool(mapped.vacant),
        last_sale_date: parseDate(mapped.last_sale_date),
        sold_price: parseMoney(mapped.sold_price),
        assessed_value: assessedValue || undefined,
        land_value: parseMoney(mapped.land_value),
        build_value: parseMoney(mapped.build_value),
        tax_value: parseMoney(mapped.tax_value),
        market_value: assessedValue || undefined,
        equity_dollar_amount: equityDollar > 0 ? Math.round(equityDollar) : undefined,
        equity_percentage: equityPct > 0 ? Math.round(equityPct * 10) / 10 : undefined,
        equity_tier: equityPct > 0 ? calcEquityTier(equityPct) : 'None',
        phone_1: normalizePhone(mapped.phone_1 || ''),
        phone_2: normalizePhone(mapped.phone_2 || ''),
        phone_3: normalizePhone(mapped.phone_3 || ''),
        phone_4: normalizePhone(mapped.phone_4 || ''),
        phone_5: normalizePhone(mapped.phone_5 || ''),
        entity_type: detectEntityType(owner),
        price_per_sqft: assessedValue && parseMoney(mapped.living_area)
          ? Math.round(assessedValue / parseMoney(mapped.living_area)!)
          : undefined,
      }

      result.leads.push(lead)
      result.created++
    } catch (err) {
      result.errors++
      result.error_log.push({ row: rowNum, reason: String(err) })
    }
  }

  return result
}
