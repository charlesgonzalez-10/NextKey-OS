import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

// PAO deep-link by county + folio/address
export function paoUrl(county: string, folio: string | null, address: string): string {
  const c = (county ?? '').toLowerCase().replace(' county', '').trim()

  // Strip the folio to digits only for counties that need it
  const rawFolio = folio ? folio.replace(/\D/g, '') : null

  if (c === 'broward') {
    // BCPA: folio-based direct link (folio = 13-digit number, e.g. 5042350130020)
    if (rawFolio) return `https://web.bcpa.net/BcpaClient/#/Account/${rawFolio}`
    // Fallback: address pre-filled in search
    const addr = encodeURIComponent(address.toUpperCase().split(',')[0].trim())
    return `https://web.bcpa.net/BcpaClient/#/Record-Search?PropertyAddress=${addr}`
  }
  if (c === 'miami-dade' || c === 'miami dade') {
    if (folio) return `https://www.miamidade.gov/Apps/PA/propertysearch/#/?folio=${encodeURIComponent(folio)}&type=folio`
    const addr = encodeURIComponent(address.split(',')[0].trim())
    return `https://www.miamidade.gov/Apps/PA/propertysearch/#/?address=${addr}&type=address`
  }
  if (c === 'palm-beach' || c === 'palm beach') {
    if (folio) return `https://www.pbcgov.org/papa/aspx/web/detail.aspx?parcel=${encodeURIComponent(folio)}`
    const addr = encodeURIComponent(address.split(',')[0].trim())
    return `https://www.pbcgov.org/papa/aspx/web/PropertySearch.aspx?addressSearch=${addr}`
  }
  if (c === 'martin') {
    const addr = encodeURIComponent(address.split(',')[0].trim())
    return `https://www.pa.martin.fl.us/search/commonsearch.aspx?mode=address&addr=${addr}`
  }
  if (c === 'st lucie' || c === 'saint lucie') {
    const addr = encodeURIComponent(address.split(',')[0].trim())
    return `https://www.paslc.gov/REWebSearch.aspx?addressSearch=${addr}`
  }
  // Fallback: Google search for the property on the county PA site
  return `https://www.google.com/search?q=${encodeURIComponent(`"${address.split(',')[0].trim()}" property appraiser florida`)}`
}

// Detect county from lat/lng bounding boxes (South Florida)
function detectCounty(lat: number, lng: number): string {
  if (lat >= 25.97 && lat <= 26.34 && lng >= -80.54 && lng <= -80.07) return 'broward'
  if (lat >= 25.11 && lat <  25.97 && lng >= -80.88 && lng <= -80.07) return 'miami-dade'
  if (lat >= 26.34 && lat <= 26.97 && lng >= -80.55 && lng <= -80.02) return 'palm-beach'
  if (lat >= 26.97 && lat <= 27.33 && lng >= -80.55 && lng <= -80.02) return 'martin'
  if (lat >= 27.17 && lat <= 27.60 && lng >= -80.68 && lng <= -80.18) return 'st lucie'
  return 'broward' // default
}

// POST /api/d4d/lookup — DB-first, free. Returns property + PAO URL.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { address, lat, lng } = await req.json()

  // Detect county for PAO URL (use coords if available, else default)
  const county = lat && lng ? detectCounty(lat, lng) : 'broward'

  // ── 1. Check our own DB first ────────────────────────────────────────────
  let dbProperty = null

  if (address) {
    // Strip unit numbers and try a broad address match
    const streetPart = address.split(',')[0].trim()
    const { data } = await serviceClient
      .from('properties')
      .select(`
        id, property_address, city, zip, county,
        owner_name, beds, baths, living_area, year_built, property_type,
        market_value, assessed_value, equity_percentage, equity_tier,
        known_debt, homestead, absentee_owner, free_clear,
        is_pre_foreclosure, is_foreclosure, is_auction,
        folio_number, latitude, longitude
      `)
      .ilike('property_address', `%${streetPart}%`)
      .limit(1)
      .maybeSingle()

    dbProperty = data
  }

  // ── 2. If not found by address, try lat/lng proximity (~50m) ────────────
  if (!dbProperty && lat && lng) {
    const delta = 0.0005 // ~55m
    const { data } = await serviceClient
      .from('properties')
      .select(`
        id, property_address, city, zip, county,
        owner_name, beds, baths, living_area, year_built, property_type,
        market_value, assessed_value, equity_percentage, equity_tier,
        known_debt, homestead, absentee_owner, free_clear,
        is_pre_foreclosure, is_foreclosure, is_auction,
        folio_number, latitude, longitude
      `)
      .gte('latitude',  lat - delta).lte('latitude',  lat + delta)
      .gte('longitude', lng - delta).lte('longitude', lng + delta)
      .limit(1)
      .maybeSingle()

    dbProperty = data
  }

  const folio    = dbProperty?.folio_number ?? null
  const propCounty = dbProperty?.county ?? county
  const propAddress = dbProperty?.property_address ?? address ?? ''

  return NextResponse.json({
    property:    dbProperty,
    pao_url:     paoUrl(propCounty, folio, propAddress),
    county,
    from_db:     !!dbProperty,
  })
}
