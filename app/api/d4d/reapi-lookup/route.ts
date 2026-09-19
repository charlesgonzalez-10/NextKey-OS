import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchPropertiesByAddress, getPropertyByCoords } from '@/lib/enrichment/reapi'
import { buildCustomerContext } from '@/lib/billing/gatewayContext'
import { detectCounty } from '@/lib/enrichment/property-search'
import { paoUrl } from '../lookup/route'

export const dynamic = 'force-dynamic'

// POST /api/d4d/reapi-lookup — explicit REAPI call, user-initiated only
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { address, lat, lng } = await req.json()
  if (!address && (!lat || !lng)) {
    return NextResponse.json({ error: 'address or lat/lng required' }, { status: 400 })
  }

  const billing = buildCustomerContext(user.id)

  if (address) {
    const county  = detectCounty(address)
    const outcome = await searchPropertiesByAddress(address, county, 1, billing)

    if (outcome.outcome === 'blocked') {
      return NextResponse.json({ error: outcome.safe_message, error_code: outcome.error_code }, { status: 402 })
    }
    if (outcome.outcome === 'provider_failed') {
      return NextResponse.json({ error: 'REAPI unavailable' }, { status: 502 })
    }

    const prop = outcome.data[0] ?? null
    if (!prop) return NextResponse.json({ property: null })

    return NextResponse.json({
      property: prop,
      pao_url:  paoUrl(prop.county, prop.folio ?? null, prop.property_address ?? address),
    })
  }

  // lat/lng path
  const county  = 'unknown' as const
  const outcome = await getPropertyByCoords(lat as number, lng as number, county, billing)

  if (outcome.outcome === 'blocked') {
    return NextResponse.json({ error: outcome.safe_message, error_code: outcome.error_code }, { status: 402 })
  }
  if (outcome.outcome === 'provider_failed') {
    return NextResponse.json({ error: 'REAPI unavailable' }, { status: 502 })
  }

  const prop = outcome.data
  if (!prop) return NextResponse.json({ property: null })

  return NextResponse.json({
    property: prop,
    pao_url:  paoUrl(prop.county, prop.folio ?? null, prop.property_address ?? ''),
  })
}
