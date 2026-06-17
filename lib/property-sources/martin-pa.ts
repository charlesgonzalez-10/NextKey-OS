/**
 * Martin County Property Appraiser stub.
 * Website: https://pa.martin.fl.us
 *
 * TODO: Implement when needed.
 * Martin County's PA website does not currently expose a stable public REST API
 * that can be used server-side without CORS issues or scraping.
 * REAPI covers Martin County data in the meantime as a paid fallback.
 *
 * When implementing:
 *   1. Check https://pa.martin.fl.us for a public JSON search endpoint
 *   2. Inspect network traffic on their property search form
 *   3. Map fields to PropertySourceResult (same pattern as broward-pa.ts)
 */

import type { PropertySourceResult } from './types'

export async function searchByAddress(
  _address: string,
  _city?: string
): Promise<PropertySourceResult | null> {
  console.log('[MartinPA] Stub — returning null, REAPI will handle Martin County')
  return null
}

export async function searchByFolio(
  _folio: string
): Promise<PropertySourceResult | null> {
  console.log('[MartinPA] Stub — returning null, REAPI will handle Martin County')
  return null
}
