/**
 * GET /api/leads/[id]/overview/snapshot
 *
 * Returns snapshot data for the Overview Property Snapshot card:
 *   - Cached rental estimate (Rentcast) — fetches fresh if >7 days old or missing
 *   - Computed/stored opportunity score
 *   - Opportunity summary sentence
 *
 * POST /api/leads/[id]/overview/snapshot
 *   Body: { force_rent?: boolean }
 *   Forces a fresh Rentcast call regardless of cache age.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import {
  shouldRefreshModule,
  snapshotBeforeUpdate,
  markModuleRefreshed,
  accumulateMarketData,
} from '@/lib/propertyService'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: prop } = await serviceClient
    .from('properties')
    .select(`
      id, market_value, estimated_value, assessed_value,
      offer_amount, mls_listing_price, mls_status, mls_active,
      mls_dom, mls_price_reductions,
      rent_estimate, rent_range_low, rent_range_high, rent_fetched_at, suggested_rent,
      equity_dollar_amount, equity_percentage, equity_tier,
      foreclosure_amount, is_pre_foreclosure, is_foreclosure, is_auction, is_probate,
      multiple_liens, vacant, homestead,
      property_address, city, zip, state, county,
      opportunity_score, opportunity_label, opportunity_summary
    `)
    .eq('id', id)
    .single()

  if (!prop) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Use property_freshness for the rental module (falls back to rent_fetched_at on first use)
  const rentStale = await shouldRefreshModule(id, 'rental')
    || (!prop.rent_estimate && !prop.suggested_rent)

  let rentEstimate = prop.rent_estimate ?? prop.suggested_rent ?? null
  let rentRangeLow = prop.rent_range_low ?? null
  let rentRangeHigh = prop.rent_range_high ?? null

  // Fetch Rentcast estimate if stale / missing
  if (rentStale) {
    try {
      const address = [prop.property_address, prop.city, prop.state ?? 'FL', prop.zip].filter(Boolean).join(', ')
      const rentRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/rentals/estimate?address=${encodeURIComponent(address)}`)
      if (rentRes.ok) {
        const rd = await rentRes.json()
        rentEstimate = rd.rent ?? rentEstimate
        rentRangeLow = rd.rentRangeLow ?? rentRangeLow
        rentRangeHigh = rd.rentRangeHigh ?? rentRangeHigh

        // Cache in DB and mark module refreshed (non-blocking)
        snapshotBeforeUpdate(id, 'rental', 'rentcast').then(() =>
          serviceClient.from('properties').update({
            rent_estimate:    rentEstimate,
            rent_range_low:   rentRangeLow,
            rent_range_high:  rentRangeHigh,
            rent_fetched_at:  new Date().toISOString(),
          }).eq('id', id)
        ).then(() =>
          markModuleRefreshed(id, 'rental', 'rentcast')
        ).then(() => {
          accumulateMarketData({
            zip:           prop.zip,
            city:          prop.city,
            county:        prop.county,
            rent_estimate: rentEstimate,
            propertyId:    id,
            source:        'rentcast',
          })
        }).catch(() => {})
      }
    } catch { /* Rentcast unavailable — return what we have */ }
  }

  return NextResponse.json({
    rent_estimate:    rentEstimate,
    rent_range_low:   rentRangeLow,
    rent_range_high:  rentRangeHigh,
    rent_fetched_at:  prop.rent_fetched_at,
    opportunity_score:   prop.opportunity_score,
    opportunity_label:   prop.opportunity_label,
    opportunity_summary: prop.opportunity_summary,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const { data: prop } = await serviceClient
    .from('properties')
    .select('property_address, city, state, zip, rent_estimate, suggested_rent')
    .eq('id', id)
    .single()

  if (!prop) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.force_rent || !prop.rent_estimate) {
    try {
      const address = [prop.property_address, prop.city, prop.state ?? 'FL', prop.zip].filter(Boolean).join(', ')
      const rentRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/rentals/estimate?address=${encodeURIComponent(address)}`)
      if (rentRes.ok) {
        const rd = await rentRes.json()
        await snapshotBeforeUpdate(id, 'rental', 'rentcast').catch(() => {})
        await serviceClient.from('properties').update({
          rent_estimate:   rd.rent,
          rent_range_low:  rd.rentRangeLow,
          rent_range_high: rd.rentRangeHigh,
          rent_fetched_at: new Date().toISOString(),
        }).eq('id', id)
        await markModuleRefreshed(id, 'rental', 'rentcast').catch(() => {})
        accumulateMarketData({
          zip:           prop.zip,
          city:          prop.city,
          county:        undefined,
          rent_estimate: rd.rent,
          propertyId:    id,
          source:        'rentcast',
        })

        return NextResponse.json({
          rent_estimate:  rd.rent,
          rent_range_low: rd.rentRangeLow,
          rent_range_high: rd.rentRangeHigh,
        })
      }
    } catch (e) {
      return NextResponse.json({ error: 'Rentcast unavailable' }, { status: 503 })
    }
  }

  return NextResponse.json({ ok: true })
}

