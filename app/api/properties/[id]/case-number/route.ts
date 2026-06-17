/**
 * PATCH /api/properties/[id]/case-number
 *
 * Manually set or update the court case number on a saved property.
 * Called from the property detail UI when REAPI didn't have the case number.
 *
 * Body:
 *   { case_number: string }
 *
 * Response:
 *   { success: true, case_number: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Property ID required' }, { status: 400 })

  let body: { case_number?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const caseNumber = body.case_number?.trim()
  if (!caseNumber) {
    return NextResponse.json({ error: 'case_number is required' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { error } = await supabase
    .from('properties')
    .update({
      case_number: caseNumber,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, case_number: caseNumber })
}
