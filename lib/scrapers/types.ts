export type County = 'miami-dade' | 'broward' | 'palm-beach'
export type EquityTier = 'High' | 'Medium' | 'Low' | 'None'
export type ForeclosureType = 'P' | 'A'  // Pre-foreclosure or Auction
export type EntityType = 'Individual' | 'LLC' | 'Corporation' | 'Trust' | 'Investment Company'

export interface ClerkRecord {
  case_number: string
  file_date: string           // YYYY-MM-DD
  plaintiff: string           // lender filing
  mortgagor: string           // borrower / owner name
  foreclosure_amount: number
  lender_name?: string
  mortgage_date?: string
  foreclosure_type: ForeclosureType
  auction_date?: string
  auction_amount?: number
  multiple_liens: boolean
  property_address?: string
  folio_number?: string
  legal_description?: string
  county: County
}

export interface PropertyAppraiserRecord {
  folio_number: string
  owner_name: string
  property_address: string
  city: string
  state: string
  zip: string
  beds?: number
  baths?: number
  pool?: boolean
  waterfront?: boolean
  gross_area?: number
  living_area?: number
  stories?: number
  lot_size?: number
  zoning?: string
  subdivision_name?: string
  legal_description?: string
  property_type?: string
  year_built?: number
  homestead: boolean
  vacant?: boolean
  last_sale_date?: string
  sold_price?: number
  assessed_value?: number
  land_value?: number
  build_value?: number
  tax_value?: number
}

export interface EnrichedLead extends ClerkRecord, Partial<PropertyAppraiserRecord> {
  // Valuation
  market_value?: number
  active_value?: number
  price_per_sqft?: number
  // Equity
  known_debt?: number
  equity_percentage?: number
  equity_dollar_amount?: number
  equity_tier?: EquityTier
  // Entity
  entity_type?: EntityType
  // Phones (manual entry)
  phone_1?: string
  phone_2?: string
  phone_3?: string
  phone_4?: string
  phone_5?: string
}

export interface ScraperRunResult {
  county: County
  new_leads: number
  skipped: number
  errors: number
  error_log: { case_number?: string; reason: string }[]
  skip_log: { case_number?: string; folio?: string; reason: string }[]
}

export interface REIFaxRow {
  // REIFax CSV column names (case-insensitive, flexible)
  [key: string]: string
}
