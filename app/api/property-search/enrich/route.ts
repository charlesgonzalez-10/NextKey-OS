import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPropertyByAPN, searchPropertiesByAddress } from '@/lib/enrichment/reapi'
import { buildCustomerContext } from '@/lib/billing/gatewayContext'
import { detectCounty } from '@/lib/enrichment/property-search'

export const dynamic = 'force-dynamic'

// POST /api/property-search/enrich
// Body: { address: string, folio?: string, county?: string }
// Returns enrichment data from REAPI — called only when user explicitly taps "Deep Enrich"
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { address, folio } = await req.json()
  if (!address && !folio) {
    return NextResponse.json({ error: 'address or folio required' }, { status: 400 })
  }

  const billing = buildCustomerContext(user.id)

  let raw: Record<string, unknown> | null = null

  if (folio) {
    const cleanApn = (folio as string).replace(/\D/g, '')
    const county   = detectCounty(address ?? '')
    const outcome  = await getPropertyByAPN(cleanApn, county, billing)

    if (outcome.outcome === 'blocked') {
      return NextResponse.json({ error: outcome.safe_message, error_code: outcome.error_code }, { status: 402 })
    }
    if (outcome.outcome === 'provider_failed') {
      return NextResponse.json({ error: 'REAPI unavailable' }, { status: 502 })
    }
    raw = outcome.data?.raw as Record<string, unknown> ?? null
  } else {
    const county  = detectCounty(address as string)
    const outcome = await searchPropertiesByAddress(address as string, county, 1, billing)

    if (outcome.outcome === 'blocked') {
      return NextResponse.json({ error: outcome.safe_message, error_code: outcome.error_code }, { status: 402 })
    }
    if (outcome.outcome === 'provider_failed') {
      return NextResponse.json({ error: 'REAPI unavailable' }, { status: 502 })
    }
    raw = outcome.data[0]?.raw as Record<string, unknown> ?? null
  }

  if (!raw) return NextResponse.json({ enrichment: null })

  const suggestedRent = raw.suggestedRent != null ? Number(raw.suggestedRent) : null

  return NextResponse.json({
    enrichment: {
      equity_percent:   raw.equityPercent        ?? null,
      estimated_equity: raw.estimatedEquity       ?? null,
      open_mortgage:    raw.openMortgageBalance   ?? null,
      estimated_value:  raw.estimatedValue        ?? null,
      suggested_rent:   isNaN(suggestedRent!) ? null : suggestedRent,
      free_clear:       raw.freeClear             ?? false,
      high_equity:      raw.highEquity            ?? false,
      absentee_owner:   raw.absenteeOwner         ?? false,
      vacant:           raw.vacant                ?? false,
      pre_foreclosure:  raw.preForeclosure        ?? false,
      foreclosure:      raw.foreclosure           ?? false,
      auction:          raw.auction               ?? false,
      tax_lien:         raw.taxLien               ?? false,
      mls_active:       raw.mlsActive             ?? false,
    },
  })
}
