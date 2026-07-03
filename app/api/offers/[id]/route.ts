/**
 * PATCH /api/offers/[id] — update an existing offer
 * DELETE /api/offers/[id] — soft-delete (set status = 'withdrawn')
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Whitelist updatable fields
  const allowed = [
    'status', 'purchase_price', 'earnest_money', 'additional_deposit',
    'seller_concessions', 'assignment_fee', 'financing_type', 'loan_amount',
    'closing_days', 'closing_date', 'inspection_days', 'deposit_days',
    'expiration_date', 'offer_type', 'base_value_type', 'base_value',
    'offer_pct', 'notes', 'deal_id',
  ]

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await serviceClient
    .from('offers')
    .update(updates)
    .eq('id', id)
    .eq('created_by', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Keep leads table in sync if purchase_price changed
  if ('purchase_price' in body && data.property_id) {
    void serviceClient
      .from('leads')
      .update({
        offer_amount: Number(body.purchase_price),
        ...(('offer_pct' in body) ? { offer_pct: Number(body.offer_pct) } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('property_id', data.property_id)
      .then(() => {}, () => {})
  }

  return NextResponse.json({ offer: data })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await serviceClient
    .from('offers')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('created_by', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
