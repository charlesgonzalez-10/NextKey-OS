/**
 * Unified property data types for NextKey OS property search.
 * All county data sources (Miami-Dade REST, REAPI, Beaches MLS) normalize
 * into these shared types so the UI only handles one shape.
 */

// ─── Core property result (from any PA source) ───────────────────────────────

export interface PropertySearchResult {
  // Identity
  folio:            string | null   // county parcel/folio ID
  county:           County
  source:           DataSource

  // Address
  property_address: string
  city:             string
  state:            string
  zip:              string

  // Ownership
  owner_name:       string | null
  mailing_address:  string | null
  owner_city:       string | null
  owner_state:      string | null
  owner_zip:        string | null
  owner_country:    string | null
  absentee_owner:   boolean         // mailing address ≠ property address

  // Property details
  property_use:     string | null   // DOR/use code description
  zoning:           string | null
  legal_desc:       string | null
  subdivision:      string | null
  neighborhood:     string | null
  municipality:     string | null

  // Building
  beds:             number | null
  baths:            number | null
  half_baths:       number | null
  living_area:      number | null   // sq ft heated/living
  building_area:    number | null   // sq ft gross
  lot_size:         number | null   // sq ft
  year_built:       number | null
  stories:          number | null
  units:            number | null

  // Valuation (current tax year)
  market_value:     number | null
  assessed_value:   number | null
  land_value:       number | null
  building_value:   number | null
  tax_year:         number | null
  annual_taxes:     number | null

  // Sale history
  last_sale_date:   string | null
  last_sale_amount: number | null
  prev_sale_date:   string | null
  prev_sale_amount: number | null

  // Distress data (from scraper_leads, if this property is in the DB)
  distress?:        PropertyDistressData

  // Links
  pa_url:           string | null   // link to county PA website for this property

  // Source provenance (added by layered lookup system)
  source_display?:       string      // human-readable, e.g. "Broward County Property Appraiser"
  source_type?:          'public' | 'paid' | 'internal'
  source_url?:           string | null
  source_confidence?:    number      // 0–100
  source_checked_at?:    string      // ISO timestamp of last successful lookup
  needs_enrichment?:     boolean     // true when source is partial (confidence < 75)

  // Raw API response for storage/debugging
  raw:              unknown
}

export interface PropertyDistressData {
  lead_id:        string
  case_number:    string | null
  folio_number:   string | null
  file_date:      string | null
  case_type:      string | null
  foreclosure_type: string | null
  plaintiff:      string | null
  lender_name:    string | null
  lien_amount:    number | null
  lien_count:     number | null
  pipeline_stage: string | null
  starred:        boolean
  lead_score:     number | null
  county:         string | null
}

// ─── Comps (from MLS / market data) ─────────────────────────────────────────

export interface PropertyComp {
  source:           CompSource
  mls_number:       string | null
  address:          string
  city:             string
  zip:              string

  // Property
  beds:             number | null
  baths:            number | null
  living_area:      number | null
  year_built:       number | null
  property_type:    string | null

  // Listing / sale
  status:           CompStatus        // 'sold' | 'active' | 'pending' | 'rental'
  list_price:       number | null
  sold_price:       number | null
  price_per_sqft:   number | null
  list_date:        string | null
  sold_date:        string | null
  days_on_market:   number | null

  // Rental
  rent_amount:      number | null     // monthly rent (if rental comp)

  distance_miles:   number | null     // distance from subject property
}

// ─── Market stats (aggregate) ─────────────────────────────────────────────────

export interface MarketStats {
  zip:                  string
  property_type:        string
  period_months:        number

  median_sold_price:    number | null
  avg_price_per_sqft:   number | null
  avg_days_on_market:   number | null
  total_sold:           number
  total_active:         number
  months_of_supply:     number | null   // absorption rate
  median_rent:          number | null
}

// ─── Enums ───────────────────────────────────────────────────────────────────

export type County     = 'miami-dade' | 'broward' | 'palm-beach' | 'martin' | 'st-lucie' | 'unknown'
export type DataSource = 'miami-dade-pa' | 'broward-pa' | 'palm-beach-pa' | 'martin-pa' | 'st-lucie-pa' | 'reapi' | 'scraper' | 'manual'
export type CompSource = 'beaches-mls' | 'miami-mls' | 'rentcast' | 'reapi'
export type CompStatus = 'sold' | 'active' | 'pending' | 'rental' | 'expired'

// ─── API request / response shapes ───────────────────────────────────────────

export interface PropertySearchRequest {
  query:    string      // address, owner name, or folio
  county?:  County      // auto-detected if omitted
  limit?:   number
}

export interface PropertySearchResponse {
  results:  PropertySearchResult[]
  total:    number
  source:   DataSource
  county:   County
}

export interface PropertyDetailResponse {
  property: PropertySearchResult
  comps:    PropertyComp[]
  market:   MarketStats | null
}
