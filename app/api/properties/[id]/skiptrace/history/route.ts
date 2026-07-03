/**
 * GET /api/properties/[id]/skiptrace/history
 * Returns all skip trace requests for this property (all statuses).
 * Used by the History panel in ContactIntelligenceTab.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data } = await serviceClient
    .from('skiptrace_requests')
    .select('id, provider, status, credits_used, cost_cents, response_time_ms, requested_at, completed_at')
    .eq('property_id', id)
    .order('requested_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ history: data ?? [] })
}
