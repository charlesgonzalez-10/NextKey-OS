/**
 * GET /api/mls/comps
 *
 * Returns sold comps + active listings for a subject property.
 * Source priority: Rentcast → Beaches MLS → 503
 *
 * Query params:
 *   address       — full property address
 *   lat / lng     — skip geocoding (Beaches MLS only)
 *   radius        — search radius in miles (default 0.5)
 *   months        — how far back for sold comps (default 12)
 *   propertyType  — 'Single Family' | 'Condominium' | 'Townhouse' | '' (all)
 *   minPrice      — min sale/list price filter
 *   maxPrice      — max sale/list price filter
 *   beds          — exact bedroom count filter
 *   baths         — exact bathroom count filter
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { fetchCompsRentcast, rentcastConfigured, RentcastError, type CompsFilter } from '@/lib/mls/rentcast'
import { fetchComps, beachesMlsConfigured, BeachesMlsError } from '@/lib/mls/beaches-mls'
import { geocodeAddress } from '@/lib/mls/geocode'
import { shouldRefreshModule, markModuleRefreshed } from '@/lib/propertyService'
import { serviceClient } from '@/lib/supabase-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams

  const address    = sp.get('address') ?? ''
  const latStr     = sp.get('lat')
  const lngStr     = sp.get('lng')
  const propertyId = sp.get('property_id') ?? null  // optional — enables freshness checks
  const forceParam = sp.get('force') === 'true'

  const radius   = parseFloat(sp.get('radius')   ?? '0.5')
  const months   = parseInt(sp.get('months')     ?? '12')
  const minPrice = sp.get('minPrice') ? parseInt(sp.get('minPrice')!) : null
  const maxPrice = sp.get('maxPrice') ? parseInt(sp.get('maxPrice')!) : null
  const beds     = sp.get('beds')     ? parseInt(sp.get('beds')!)     : null
  const baths    = sp.get('baths')    ? parseFloat(sp.get('baths')!)  : null
  const propType = sp.get('propertyType') ?? ''

  const filter: Partial<CompsFilter> = {
    radiusMi:     isNaN(radius) ? 0.5 : radius,
    monthsBack:   isNaN(months) ? 12  : months,
    propertyType: propType,
    minPrice,
    maxPrice,
    beds,
    baths,
  }

  // ── Freshness check (if property_id provided) ─────────────────────────────────
  if (propertyId && !forceParam) {
    const isStale = await shouldRefreshModule(propertyId, 'comps')
    if (!isStale) {
      return NextResponse.json({ cached: true, comps: [], message: 'Comps are fresh — use cached lead_comps' })
    }
  }

  // ── Rentcast ──────────────────────────────────────────────────────────────────
  if (rentcastConfigured()) {
    if (!address) {
      return NextResponse.json({ error: 'address param required', code: 'NO_ADDRESS' }, { status: 400 })
    }
    const t0 = Date.now()
    try {
      const result = await fetchCompsRentcast(address, filter)
      // Platform-absorbed usage record: Rentcast billing model unconfirmed; treated as
      // NextKey cost. Recorded so vendor spend is not financially invisible.
      serviceClient.from('api_usage_events').insert({
        request_id:           randomUUID(),
        pool_key:             'background_operations',
        provider_key:         'rentcast',
        feature_key:          'rental_analysis',
        estimated_cost_cents: 5,
        actual_cost_cents:    5,
        success:              true,
        cache_hit:            false,
        provider_called:      true,
        duration_ms:          Date.now() - t0,
      }).then(() => {}, () => {})
      if (propertyId) {
        markModuleRefreshed(propertyId, 'comps', 'rentcast').catch(() => {})
      }
      return NextResponse.json(result)
    } catch (err) {
      serviceClient.from('api_usage_events').insert({
        request_id:           randomUUID(),
        pool_key:             'background_operations',
        provider_key:         'rentcast',
        feature_key:          'rental_analysis',
        estimated_cost_cents: 5,
        actual_cost_cents:    0,
        success:              false,
        cache_hit:            false,
        provider_called:      true,
        duration_ms:          Date.now() - t0,
      }).then(() => {}, () => {})
      if (err instanceof RentcastError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === 'QUOTA' ? 402 : 502 })
      }
      return NextResponse.json({ error: String(err), code: 'UNKNOWN' }, { status: 500 })
    }
  }

  // ── Beaches MLS ───────────────────────────────────────────────────────────────
  if (beachesMlsConfigured()) {
    let lat = latStr ? parseFloat(latStr) : null
    let lng = lngStr ? parseFloat(lngStr) : null
    if ((!lat || !lng) && address) {
      const geo = await geocodeAddress(address)
      if (geo) { lat = geo.lat; lng = geo.lng }
    }
    if (!lat || !lng) {
      return NextResponse.json({ error: 'Could not determine property location', code: 'NO_LOCATION' }, { status: 400 })
    }
    try {
      const result = await fetchComps(lat, lng, { radiusMi: filter.radiusMi, monthsBack: filter.monthsBack })
      if (propertyId) {
        markModuleRefreshed(propertyId, 'comps', 'beaches-mls').catch(() => {})
      }
      return NextResponse.json(result)
    } catch (err) {
      if (err instanceof BeachesMlsError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 502 })
      }
      return NextResponse.json({ error: String(err), code: 'UNKNOWN' }, { status: 500 })
    }
  }

  return NextResponse.json(
    { error: 'No comps source configured. Add RENTCAST_API_KEY to your environment.', code: 'NO_CREDENTIALS' },
    { status: 503 }
  )
}
