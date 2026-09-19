/**
 * GET /api/rentals/estimate
 *
 * Returns a long-term rental estimate for a subject property via Rentcast.
 * Endpoint: GET https://api.rentcast.io/v1/avm/rent/long-term?address=...
 *
 * Query params:
 *   address — full property address (required)
 *
 * Response:
 *   { rent, rentRangeLow, rentRangeHigh, latitude, longitude }
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { serviceClient } from '@/lib/supabase-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BASE = 'https://api.rentcast.io/v1'
const KEY  = process.env.RENTCAST_API_KEY

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''

  if (!KEY) {
    return NextResponse.json({ error: 'Rentcast API key not configured', code: 'NO_CREDENTIALS' }, { status: 503 })
  }

  if (!address) {
    return NextResponse.json({ error: 'address param required', code: 'NO_ADDRESS' }, { status: 400 })
  }

  const t0 = Date.now()
  try {
    const url  = `${BASE}/avm/rent/long-term?address=${encodeURIComponent(address)}`
    const res  = await fetch(url, {
      headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' },
      cache: 'no-store',
    })

    if (!res.ok) {
      // Platform-absorbed usage record on provider error
      serviceClient.from('api_usage_events').insert({
        request_id: randomUUID(), pool_key: 'background_operations',
        provider_key: 'rentcast', feature_key: 'rental_analysis',
        estimated_cost_cents: 5, actual_cost_cents: 0,
        success: false, cache_hit: false, provider_called: true,
        duration_ms: Date.now() - t0,
      }).then(() => {}, () => {})
      const body = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: body?.message ?? `Rentcast error ${res.status}`, code: 'RENTCAST_ERROR' },
        { status: res.status }
      )
    }

    const data = await res.json()

    // Platform-absorbed usage record: Rentcast billing model unconfirmed; treated as
    // NextKey cost. Recorded so vendor spend is not financially invisible.
    serviceClient.from('api_usage_events').insert({
      request_id: randomUUID(), pool_key: 'background_operations',
      provider_key: 'rentcast', feature_key: 'rental_analysis',
      estimated_cost_cents: 5, actual_cost_cents: 5,
      success: true, cache_hit: false, provider_called: true,
      duration_ms: Date.now() - t0,
    }).then(() => {}, () => {})

    return NextResponse.json({
      rent:          data.rent          ?? null,
      rentRangeLow:  data.rentRangeLow  ?? null,
      rentRangeHigh: data.rentRangeHigh ?? null,
      latitude:      data.latitude      ?? null,
      longitude:     data.longitude     ?? null,
      address:       data.addressLine1  ?? address,
    })
  } catch (err) {
    serviceClient.from('api_usage_events').insert({
      request_id: randomUUID(), pool_key: 'background_operations',
      provider_key: 'rentcast', feature_key: 'rental_analysis',
      estimated_cost_cents: 5, actual_cost_cents: 0,
      success: false, cache_hit: false, provider_called: true,
      duration_ms: Date.now() - t0,
    }).then(() => {}, () => {})
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Network error', code: 'FETCH_ERROR' },
      { status: 500 }
    )
  }
}
