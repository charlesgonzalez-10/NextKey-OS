import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { BlueprintService } from '@/lib/documents/blueprintService'

export const dynamic = 'force-dynamic'

// GET /api/signer-roles — return the canonical signer role catalog
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const roles = await BlueprintService.getRoles()
    return NextResponse.json({ roles })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
