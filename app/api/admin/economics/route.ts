// GET /api/admin/economics
// Returns the full economics dashboard payload.
// Admin-only. Read-only — no mutations, no reservations, no credits consumed.
// Revenue section is null until Stripe live mode is enabled.

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import { economicsService }          from '@/lib/billing/economicsService'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const period = req.nextUrl.searchParams.get('period') ?? 'current_month'

  const dashboard = await economicsService.getDashboard(period)
  return NextResponse.json(dashboard)
}
