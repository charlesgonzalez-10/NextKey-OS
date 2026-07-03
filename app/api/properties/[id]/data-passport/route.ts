/**
 * GET /api/properties/[id]/data-passport
 * Returns field-level data provenance for a property (the Data Passport).
 * Used by DataPassportPanel in the workspace Analyze tab.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDataPassport } from '@/lib/dsoe'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const passport = await getDataPassport(id)

  return NextResponse.json({ passport })
}
