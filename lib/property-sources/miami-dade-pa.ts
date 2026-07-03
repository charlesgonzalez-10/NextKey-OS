/**
 * Miami-Dade Property Appraiser adapter.
 *
 * Wraps the existing enrichment/miami-dade-pa functions into the
 * PropertySourceResult interface so the registry can treat Miami-Dade
 * identically to Broward, Palm Beach, etc.
 *
 * Address search flow: address → GIS folio lookup → PA detail call
 * Folio search flow:   folio → PA detail call (skip GIS)
 */

import { findFolioByAddressGIS, enrichFromMiamiDadePA } from '../enrichment/miami-dade-pa'
import type { PropertySourceResult } from './types'

export async function searchByAddress(address: string): Promise<PropertySourceResult & { folio: string } | null> {
  const gis = await findFolioByAddressGIS(address)
  if (!gis?.folio) return null
  return searchByFolio(gis.folio)
}

export async function searchByFolio(folio: string): Promise<PropertySourceResult & { folio: string } | null> {
  const raw = await enrichFromMiamiDadePA(folio)
  if (!raw) return null

  return {
    source:            'miami_dade_pa',
    sourceType:        'public',
    sourceDisplayName: 'Miami-Dade Property Appraiser',
    confidence:        90,

    folio,
    county:   'miami-dade',
    state:    'FL',

    owner_name:      raw.owner_name,
    mailing_address: raw.mailing_address,
    owner_state:     raw.owner_state,
    owner_zip:       raw.owner_zip,
    owner_country:   raw.owner_country,

    legal_desc:   raw.legal_desc,
    zoning:       raw.zoning,
    property_use: raw.property_use,
    subdivision:  raw.subdivision,

    beds:        raw.beds,
    baths:       raw.baths,
    living_area: raw.living_area,
    year_built:  raw.year_built,
    lot_size:    raw.lot_size,

    market_value:    raw.market_value,
    assessed_value:  raw.assessed_value,
    land_value:      raw.land_value,
    building_value:  raw.building_value,
    tax_year:        raw.tax_year,

    last_sale_date:   raw.last_sale_date,
    last_sale_amount: raw.last_sale_amount,
    prev_sale_date:   raw.prev_sale_date,
    prev_sale_amount: raw.prev_sale_amount,

    raw: raw.raw,
  }
}
