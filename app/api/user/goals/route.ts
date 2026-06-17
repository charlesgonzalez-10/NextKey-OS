import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

function currentMonthStart() {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const month = currentMonthStart()

  const { data } = await serviceClient
    .from('user_goals')
    .select('*')
    .eq('user_id', user.id)
    .eq('month', month)
    .single()

  // Return defaults if no record yet
  return NextResponse.json(data ?? {
    user_id:       user.id,
    month,
    lead_goal:     50,
    deal_goal:     5,
    contract_goal: 2,
    revenue_goal:  0,
  })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const month = currentMonthStart()

  const { data, error } = await serviceClient
    .from('user_goals')
    .upsert({
      user_id:       user.id,
      month,
      lead_goal:     Number(body.lead_goal)     || 50,
      deal_goal:     Number(body.deal_goal)     || 5,
      contract_goal: Number(body.contract_goal) || 2,
      revenue_goal:  Number(body.revenue_goal)  || 0,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'user_id,month' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
