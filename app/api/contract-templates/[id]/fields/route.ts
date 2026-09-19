import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { BlueprintService } from '@/lib/documents/blueprintService'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

async function verifyOwner(templateId: string, userId: string): Promise<boolean> {
  const { data } = await serviceClient
    .from('contract_templates')
    .select('user_id')
    .eq('id', templateId)
    .single()
  return data?.user_id === userId
}

// GET /api/contract-templates/[id]/fields — returns draft template_fields in builder format
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!await verifyOwner(id, user.id))
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const fields = await BlueprintService.getDraftFields(id)
    return NextResponse.json({ fields })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

// POST /api/contract-templates/[id]/fields — batch-sync all draft fields
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!await verifyOwner(id, user.id))
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  if (!Array.isArray(body.fields))
    return NextResponse.json({ error: 'fields must be an array' }, { status: 400 })

  try {
    const fields = await BlueprintService.syncDraftFields(id, body.fields, user.id)
    return NextResponse.json({ fields })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
