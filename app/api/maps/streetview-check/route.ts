/**
 * GET /api/maps/streetview-check?location=<url-encoded-address>
 *
 * Server-side proxy for the Street View Metadata API (FREE — no billing charge).
 * Checks whether Google Street View imagery is available for a given location.
 *
 * We proxy this server-side so:
 *   1. The API key never needs to be exposed in JS bundles beyond what NEXT_PUBLIC_ allows
 *   2. We can set the Referer header to match the key's HTTP restriction (nextkeyos.vercel.app)
 *   3. Client never sees a raw Google error — just { available: true/false }
 */

import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ORIGIN = 'https://nextkeyos.vercel.app'

export async function GET(req: NextRequest) {
  const location = req.nextUrl.searchParams.get('location')
  if (!location) {
    return NextResponse.json({ available: false, error: 'missing location' }, { status: 400 })
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ available: false, error: 'no api key' })
  }

  try {
    const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${encodeURIComponent(location)}&key=${apiKey}`
    const resp = await fetch(metaUrl, {
      headers: {
        // Match the HTTP referrer restriction on the API key
        'Referer': ALLOWED_ORIGIN,
      },
      // Short timeout — this should be very fast
      signal: AbortSignal.timeout(5000),
    })

    if (!resp.ok) {
      // 403 = API key restriction / API not enabled → street view simply not available
      return NextResponse.json({ available: false, statusCode: resp.status })
    }

    // Successful JSON from metadata endpoint
    const data = await resp.json() as { status: string }
    // status === 'OK' means imagery exists; 'ZERO_RESULTS' or 'NOT_FOUND' = not available
    return NextResponse.json({ available: data.status === 'OK', googleStatus: data.status })
  } catch {
    // Network error / timeout — assume unavailable
    return NextResponse.json({ available: false, error: 'fetch_failed' })
  }
}
