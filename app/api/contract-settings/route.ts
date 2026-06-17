import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await serviceClient
    .from('contract_settings')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data ?? {})
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const fields = {
    company_name:        body.company_name        ?? null,
    entity_name:         body.entity_name         ?? null,
    mailing_address:     body.mailing_address     ?? null,
    phone:               body.phone               ?? null,
    email:               body.email               ?? null,
    website:             body.website             ?? null,
    broker_name:         body.broker_name         ?? null,
    broker_license:      body.broker_license      ?? null,
    license_number:      body.license_number      ?? null,
    buyer_name:          body.buyer_name          ?? null,
    acceptance_days:     body.acceptance_days     ?? 3,
    inspection_days:     body.inspection_days     ?? 10,
    closing_days:        body.closing_days        ?? 30,
    earnest_money_amount: body.earnest_money_amount ?? 1000,
    closing_location:    body.closing_location    ?? null,
    escrow_instructions: body.escrow_instructions ?? null,
    updated_at:          new Date().toISOString(),
  }

  const { data, error } = await serviceClient
    .from('contract_settings')
    .upsert({ user_id: user.id, ...fields }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
