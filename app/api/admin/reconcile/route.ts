/**
 * GET  /api/admin/reconcile — read-only preview: classifies stale reservations
 *   and computes expected post-reconciliation state. Zero mutations.
 *
 * POST /api/admin/reconcile — owner-only: runs classified reconciliation, then
 *   verifies the result. Idempotent — safe to call multiple times.
 *
 * Security: owner role required. Never deletes ledger rows.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import {
  computeReconciliationPreview,
  reconcileStaleReservations,
  verifyReconciliation,
} from '@/lib/billing/reconciliationService'

export const dynamic = 'force-dynamic'

async function authorize() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) return null
  return user
}

/** Read-only preview — classifies stale reservations and returns expected state. */
export async function GET() {
  const user = await authorize()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const preview = await computeReconciliationPreview()
    return NextResponse.json({ ok: true, ...preview })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Reconcile/Preview] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** Execute classified reconciliation, then verify. */
export async function POST() {
  const user = await authorize()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const result = await reconcileStaleReservations()

    console.log(
      `[Reconcile] run_at=${result.run_at} ` +
      `A_processed=${result.category_A_processed} ` +
      `B_processed=${result.category_B_processed} ` +
      `C_needs_review=${result.category_C_needs_review} ` +
      `drift_corrected=${result.drift_corrected} ` +
      `errors=${result.errors.length}`
    )

    const verification = await verifyReconciliation()

    return NextResponse.json({ ok: true, result, verification })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Reconcile] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
