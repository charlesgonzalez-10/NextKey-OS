/**
 * GET  /api/offers?property_id=<id>&latest=true  — latest active offer for a property
 * GET  /api/offers?property_id=<id>              — all offers for a property
 * POST /api/offers                               — create a new offer
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const property_id = req.nextUrl.searchParams.get('property_id')
  const latest      = req.nextUrl.searchParams.get('latest') === 'true'

  if (!property_id) return NextResponse.json({ error: 'property_id required' }, { status: 400 })

  let query = serviceClient
    .from('offers')
    .select('*')
    .eq('property_id', property_id)
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

  if (latest) {
    const { data, error } = await query.limit(1).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ offer: data })
  }

  const { data, error } = await query.limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ offers: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    property_id, lead_id, deal_id, parent_offer_id,
    purchase_price, earnest_money, additional_deposit, seller_concessions, assignment_fee,
    financing_type, loan_amount, closing_days, closing_date, inspection_days,
    deposit_days, expiration_date, offer_type, base_value_type, base_value,
    offer_pct, notes, status,
  } = body as Record<string, unknown>

  if (!property_id) return NextResponse.json({ error: 'property_id required' }, { status: 400 })
  if (!purchase_price || Number(purchase_price) <= 0) return NextResponse.json({ error: 'purchase_price required' }, { status: 400 })

  const { data, error } = await serviceClient
    .from('offers')
    .insert({
      property_id,
      lead_id:            lead_id            ?? null,
      deal_id:            deal_id            ?? null,
      parent_offer_id:    parent_offer_id    ?? null,
      status:             status             ?? 'active',
      purchase_price:     Number(purchase_price),
      earnest_money:      earnest_money      != null ? Number(earnest_money)      : null,
      additional_deposit: additional_deposit != null ? Number(additional_deposit) : null,
      seller_concessions: seller_concessions != null ? Number(seller_concessions) : null,
      assignment_fee:     assignment_fee     != null ? Number(assignment_fee)     : null,
      financing_type:     financing_type     ?? 'Cash',
      loan_amount:        loan_amount        != null ? Number(loan_amount)        : null,
      closing_days:       closing_days       != null ? Number(closing_days)       : 30,
      closing_date:       closing_date       ?? null,
      inspection_days:    inspection_days    != null ? Number(inspection_days)    : 10,
      deposit_days:       deposit_days       != null ? Number(deposit_days)       : 3,
      expiration_date:    expiration_date    ?? null,
      offer_type:         offer_type         ?? 'wholesale',
      base_value_type:    base_value_type    ?? 'market',
      base_value:         base_value         != null ? Number(base_value)         : null,
      offer_pct:          offer_pct          != null ? Number(offer_pct)          : null,
      notes:              notes              ?? null,
      created_by:         user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Also update leads row for backward compat
  if (lead_id) {
    void serviceClient
      .from('leads')
      .update({ offer_amount: Number(purchase_price), offer_pct: offer_pct != null ? Number(offer_pct) : null, pipeline_stage: 'offer', updated_at: new Date().toISOString() })
      .eq('property_id', property_id)
      .then(() => {}, () => {})
  }

  return NextResponse.json({ offer: data }, { status: 201 })
}
