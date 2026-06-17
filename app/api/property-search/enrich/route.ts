import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const REAPI_BASE = 'https://api.realestateapi.com/v2'

// POST /api/property-search/enrich
// Body: { address: string, folio?: string, county?: string }
// Returns enrichment data from REAPI — called only when user explicitly taps "Deep Enrich"
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = process.env.REAPI_KEY
  if (!key) return NextResponse.json({ error: 'REAPI not configured — contact admin' }, { status: 503 })

  const { address, folio } = await req.json()
  if (!address && !folio) {
    return NextResponse.json({ error: 'address or folio required' }, { status: 400 })
  }

  const body: Record<string, unknown> = { size: 1 }
  if (folio) body.apn = folio.replace(/\D/g, '')
  else body.address = address

  const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(12_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return NextResponse.json({ error: `REAPI ${res.status}: ${text.slice(0, 120)}` }, { status: 502 })
  }

  const data = await res.json()
  const raw  = Array.isArray(data.data) ? data.data[0] : data.data
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
