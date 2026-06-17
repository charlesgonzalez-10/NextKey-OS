import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normaliseREAPIProperty } from '@/lib/search/reapi-search'
import { paoUrl } from '../lookup/route'

export const dynamic = 'force-dynamic'

const REAPI_BASE = 'https://api.realestateapi.com/v2'

// POST /api/d4d/reapi-lookup — explicit REAPI call, user-initiated only
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { address, lat, lng } = await req.json()
  if (!address && (!lat || !lng)) {
    return NextResponse.json({ error: 'address or lat/lng required' }, { status: 400 })
  }

  const key = process.env.REAPI_KEY
  if (!key) return NextResponse.json({ error: 'REAPI not configured' }, { status: 503 })

  const body: Record<string, unknown> = { size: 1 }
  if (address) {
    body.address = address
  } else {
    body.latitude  = lat
    body.longitude = lng
    body.radius    = 0.05
  }

  const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(10_000),
  })

  if (!res.ok) return NextResponse.json({ error: `REAPI ${res.status}` }, { status: 502 })

  const data = await res.json()
  const raw  = data.data?.[0]
  if (!raw) return NextResponse.json({ property: null })

  const prop = normaliseREAPIProperty(raw)

  return NextResponse.json({
    property: prop,
    pao_url:  paoUrl(prop.county, prop.folio_number, prop.property_address ?? address ?? ''),
  })
}
