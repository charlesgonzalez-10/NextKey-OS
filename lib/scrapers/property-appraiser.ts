/**
 * Florida County Property Appraiser API integrations
 * Each county has a different but public API/website
 */

import type { PropertyAppraiserRecord } from './types'

const PA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; NextKey/1.0; +https://nextkeyps.com)',
  'Accept': 'application/json, text/html, */*',
}

// ─── Miami-Dade PA ────────────────────────────────────────────────────────────
// Public API: https://www.miamidade.gov/Apps/PA/PApublicServiceProxy/PaServicesProxy.ashx

export async function fetchMiamiDadePA(
  query: { folio?: string; address?: string }
): Promise<PropertyAppraiserRecord | null> {
  try {
    let url: string

    if (query.folio) {
      const cleanFolio = query.folio.replace(/[-\s]/g, '')
      url = `https://www.miamidade.gov/Apps/PA/PApublicServiceProxy/PaServicesProxy.ashx?` +
        `Operation=GetPropertySearchByFolio&clientId=&folioNumber=${encodeURIComponent(cleanFolio)}&` +
        `statusType=A&fromIndex=1&toIndex=1`
    } else if (query.address) {
      url = `https://www.miamidade.gov/Apps/PA/PApublicServiceProxy/PaServicesProxy.ashx?` +
        `Operation=GetPropertySearchByAddress&clientId=&myAddress=${encodeURIComponent(query.address)}&` +
        `myUnit=&fromIndex=1&toIndex=1`
    } else {
      return null
    }

    const res = await fetch(url, { headers: PA_HEADERS, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null

    const json = await res.json()
    const prop = json?.MinimumPropertyInfos?.MinimumPropertyInfo?.[0] ||
                 json?.PropertyInfo?.[0]
    if (!prop) return null

    return parseMiamiDadePARecord(prop)
  } catch (err) {
    console.error('Miami-Dade PA fetch error:', err)
    return null
  }
}

function parseMiamiDadePARecord(prop: Record<string, unknown>): PropertyAppraiserRecord {
  const addr = `${prop.SiteAddress || ''} ${prop.SiteCity || ''}`.trim()
  return {
    folio_number: String(prop.Strap || prop.FolioNumber || '').replace(/\D/g, '').replace(/(\d{2})(\d{4})(\d{3})(\d{4})/, '$1-$2-$3-$4'),
    owner_name: String(prop.OwnerName1 || prop.Owner1 || ''),
    property_address: String(prop.SiteAddress || prop.Address || ''),
    city: String(prop.SiteCity || prop.City || 'Miami'),
    state: 'FL',
    zip: String(prop.SiteZip || prop.ZipCode || ''),
    beds: parseFloat(String(prop.Bedrooms || prop.Beds || '0')) || undefined,
    baths: parseFloat(String(prop.Bathrooms || prop.Baths || '0')) || undefined,
    pool: String(prop.Pool || '').toUpperCase() === 'Y',
    waterfront: String(prop.Waterfront || '').toUpperCase() === 'Y',
    gross_area: parseFloat(String(prop.GrossArea || '0')) || undefined,
    living_area: parseFloat(String(prop.LivingArea || prop.ActualArea || '0')) || undefined,
    stories: parseFloat(String(prop.Stories || '0')) || undefined,
    lot_size: parseFloat(String(prop.LotSize || '0')) || undefined,
    zoning: String(prop.ZoningCode || ''),
    subdivision_name: String(prop.SubdivisionName || prop.Subdivision || ''),
    legal_description: String(prop.LegalDescription || ''),
    property_type: String(prop.PrimaryZone || prop.PropertyType || ''),
    year_built: parseInt(String(prop.YearBuilt || '0')) || undefined,
    homestead: String(prop.Homestead || prop.HomeSteadExemption || '').toUpperCase() === 'Y' ||
               String(prop.ExemptionCode || '').includes('HX'),
    last_sale_date: String(prop.SaleDate || prop.LastSaleDate || '') || undefined,
    sold_price: parseFloat(String(prop.SalePrice || prop.LastSalePrice || '0')) || undefined,
    assessed_value: parseFloat(String(prop.AssessedValue || prop.JustValue || '0')) || undefined,
    land_value: parseFloat(String(prop.LandValue || '0')) || undefined,
    build_value: parseFloat(String(prop.BuildingValue || '0')) || undefined,
    tax_value: parseFloat(String(prop.TaxableValue || '0')) || undefined,
  }
}

// ─── Broward PA ────────────────────────────────────────────────────────────────
// Public site: https://www.bcpa.net

export async function fetchBrowardPA(
  query: { folio?: string; address?: string }
): Promise<PropertyAppraiserRecord | null> {
  try {
    // Broward PA has a JSON endpoint
    let url: string

    if (query.folio) {
      const cleanFolio = query.folio.replace(/[-\s]/g, '')
      url = `https://www.bcpa.net/RecInfo.asp?URL_Folio=${encodeURIComponent(cleanFolio)}&json=1`
    } else if (query.address) {
      const parts = query.address.split(' ')
      const streetNum = parts[0] || ''
      const streetName = parts.slice(1).join('+')
      url = `https://www.bcpa.net/RecInfo.asp?URL_Name=&URL_StreetNum=${streetNum}&URL_StreetName=${streetName}&json=1`
    } else {
      return null
    }

    const res = await fetch(url, { headers: PA_HEADERS, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null

    // Broward PA returns HTML, parse key fields
    const html = await res.text()
    return parseBrowardPAHtml(html, query.folio)
  } catch (err) {
    console.error('Broward PA fetch error:', err)
    return null
  }
}

function parseBrowardPAHtml(html: string, folio?: string): PropertyAppraiserRecord | null {
  // Extract key values using regex patterns matching Broward PA HTML structure
  const get = (pattern: RegExp) => {
    const m = html.match(pattern)
    return m ? m[1]?.trim() : undefined
  }

  const ownerName = get(/Owner Name[^>]*>[^<]*<[^>]*>([^<]+)/)
  const address   = get(/Site Address[^>]*>[^<]*<[^>]*>([^<]+)/)
  if (!ownerName && !address) return null

  return {
    folio_number: folio || get(/Folio Number[^>]*>[^<]*<[^>]*>([^<]+)/) || '',
    owner_name: ownerName || '',
    property_address: address || '',
    city: get(/City[^>]*>[^<]*<[^>]*>([^<]+)/) || '',
    state: 'FL',
    zip: get(/Zip[^>]*>[^<]*<[^>]*>([^<]+)/) || '',
    beds: parseFloat(get(/Bedrooms?[^>]*>[^<]*<[^>]*>(\d+)/) || '0') || undefined,
    baths: parseFloat(get(/Bathrooms?[^>]*>[^<]*<[^>]*>([.\d]+)/) || '0') || undefined,
    living_area: parseFloat((get(/Living Area[^>]*>[^<]*<[^>]*>([\d,]+)/) || '').replace(/,/g, '')) || undefined,
    year_built: parseInt(get(/Year Built[^>]*>[^<]*<[^>]*>(\d{4})/) || '0') || undefined,
    homestead: html.toLowerCase().includes('homestead exemption'),
    assessed_value: parseFloat((get(/Assessed Value[^>]*>[^<]*<[^>]*>\$?([\d,]+)/) || '').replace(/,/g, '')) || undefined,
    sold_price: parseFloat((get(/Sale Price[^>]*>[^<]*<[^>]*>\$?([\d,]+)/) || '').replace(/,/g, '')) || undefined,
  }
}

// ─── Palm Beach PA ────────────────────────────────────────────────────────────
// Public site: https://www.pbcgov.com/papa/

export async function fetchPalmBeachPA(
  query: { folio?: string; address?: string }
): Promise<PropertyAppraiserRecord | null> {
  try {
    // Palm Beach PA has a search interface
    let url: string

    if (query.folio) {
      url = `https://www.pbcgov.com/papa/Asps/PropertyDetail/PropertyDetail.aspx?parcel=${encodeURIComponent(query.folio)}&SearchType=1`
    } else if (query.address) {
      url = `https://www.pbcgov.com/papa/Asps/PropertySearch/PropertySearch.aspx?SearchType=2&Address=${encodeURIComponent(query.address)}`
    } else {
      return null
    }

    const res = await fetch(url, { headers: PA_HEADERS, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null

    const html = await res.text()
    return parsePalmBeachPAHtml(html, query.folio)
  } catch (err) {
    console.error('Palm Beach PA fetch error:', err)
    return null
  }
}

function parsePalmBeachPAHtml(html: string, folio?: string): PropertyAppraiserRecord | null {
  const get = (pattern: RegExp) => {
    const m = html.match(pattern)
    return m ? m[1]?.trim() : undefined
  }

  const ownerName = get(/Owner Name.*?<\/td>\s*<td[^>]*>([^<]+)/i)
  if (!ownerName) return null

  return {
    folio_number: folio || get(/Parcel.*?<\/td>\s*<td[^>]*>([^<]+)/i) || '',
    owner_name: ownerName,
    property_address: get(/Site Address.*?<\/td>\s*<td[^>]*>([^<]+)/i) || '',
    city: get(/City.*?<\/td>\s*<td[^>]*>([^<]+)/i) || '',
    state: 'FL',
    zip: get(/Zip.*?<\/td>\s*<td[^>]*>([^<]+)/i) || '',
    beds: parseFloat(get(/Bedrooms.*?<\/td>\s*<td[^>]*>(\d+)/i) || '0') || undefined,
    baths: parseFloat(get(/Bathrooms.*?<\/td>\s*<td[^>]*>([.\d]+)/i) || '0') || undefined,
    living_area: parseFloat((get(/Living Area.*?<\/td>\s*<td[^>]*>([\d,]+)/i) || '').replace(/,/g, '')) || undefined,
    year_built: parseInt(get(/Year Built.*?<\/td>\s*<td[^>]*>(\d{4})/i) || '0') || undefined,
    homestead: /homestead/i.test(html),
    assessed_value: parseFloat((get(/Total Assessed.*?<\/td>\s*<td[^>]*>\$?([\d,]+)/i) || '').replace(/,/g, '')) || undefined,
  }
}

// ─── Router — pick right PA by county ─────────────────────────────────────────

export async function fetchPropertyData(
  county: string,
  query: { folio?: string; address?: string }
): Promise<PropertyAppraiserRecord | null> {
  switch (county) {
    case 'miami-dade': return fetchMiamiDadePA(query)
    case 'broward':    return fetchBrowardPA(query)
    case 'palm-beach': return fetchPalmBeachPA(query)
    default: return null
  }
}
