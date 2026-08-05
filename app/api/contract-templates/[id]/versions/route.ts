import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { BlueprintService } from '@/lib/documents/blueprintService'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

// GET /api/contract-templates/[id]/versions — list all published versions
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: tmpl } = await serviceClient
    .from('contract_templates')
    .select('user_id')
    .eq('id', id)
    .single()
  if (!tmpl || tmpl.user_id !== user.id)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const versions = await BlueprintService.getBlueprintVersions(id)
    return NextResponse.json({ versions })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
