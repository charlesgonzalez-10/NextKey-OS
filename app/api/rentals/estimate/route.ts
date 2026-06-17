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

import { NextRequest, NextResponse } from 'next/server'

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

  try {
    const url  = `${BASE}/avm/rent/long-term?address=${encodeURIComponent(address)}`
    const res  = await fetch(url, {
      headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' },
      cache: 'no-store',
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: body?.message ?? `Rentcast error ${res.status}`, code: 'RENTCAST_ERROR' },
        { status: res.status }
      )
    }

    const data = await res.json()

    return NextResponse.json({
      rent:          data.rent          ?? null,
      rentRangeLow:  data.rentRangeLow  ?? null,
      rentRangeHigh: data.rentRangeHigh ?? null,
      latitude:      data.latitude      ?? null,
      longitude:     data.longitude     ?? null,
      address:       data.addressLine1  ?? address,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Network error', code: 'FETCH_ERROR' },
      { status: 500 }
    )
  }
}
