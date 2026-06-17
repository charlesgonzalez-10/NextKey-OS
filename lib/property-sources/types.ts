/**
 * Shared types for the layered property source system.
 *
 * All county PA adapters (Broward, Palm Beach, Martin, St. Lucie, etc.) and
 * paid sources (REAPI) map their raw responses into PropertySourceResult so
 * the registry can compare and merge results uniformly.
 */

// ─── Source interface ─────────────────────────────────────────────────────────

export interface PropertySource {
  name: string             // e.g. 'broward_pa'
  displayName: string      // e.g. 'Broward County Property Appraiser'
  type: 'internal' | 'public' | 'paid'
  county?: string
  searchByAddress(address: string, city?: string): Promise<PropertySourceResult | null>
  searchByFolio(folio: string): Promise<PropertySourceResult | null>
  searchByOwner?(name: string): Promise<PropertySourceResult[]>
}

// ─── Normalized result — all sources map into this shape ─────────────────────

export interface PropertySourceResult {
  // Source provenance
  source:             string
  sourceType:         'internal' | 'public' | 'paid'
  sourceDisplayName:  string
  sourceUrl?:         string | null
  /**
   * 0–100. Used to decide if REAPI deep-enrich is needed.
   * 85+ = full data (address + owner + value); 60 = partial; below 60 = minimal.
   */
  confidence:         number

  // All property fields are optional — some sources only return a subset
  folio?:             string | null
  county?:            string
  property_address?:  string
  city?:              string
  state?:             string
  zip?:               string
  owner_name?:        string | null
  mailing_address?:   string | null
  owner_city?:        string | null
  owner_state?:       string | null
  owner_zip?:         string | null
  owner_country?:     string | null
  absentee_owner?:    boolean
  property_use?:      string | null
  zoning?:            string | null
  legal_desc?:        string | null
  subdivision?:       string | null
  neighborhood?:      string | null
  municipality?:      string | null
  beds?:              number | null
  baths?:             number | null
  half_baths?:        number | null
  living_area?:       number | null
  building_area?:     number | null
  lot_size?:          number | null
  year_built?:        number | null
  stories?:           number | null
  units?:             number | null
  market_value?:      number | null
  assessed_value?:    number | null
  land_value?:        number | null
  building_value?:    number | null
  taxable_value?:     number | null
  tax_year?:          number | null
  annual_taxes?:      number | null
  last_sale_date?:    string | null
  last_sale_amount?:  number | null
  prev_sale_date?:    string | null
  prev_sale_amount?:  number | null
  homestead?:         boolean
  pa_url?:            string | null
  raw?:               unknown
}
