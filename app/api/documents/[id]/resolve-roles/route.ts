import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { resolveRoles } from '@/lib/documents/roleResolutionService'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

// POST /api/documents/[id]/resolve-roles
// Body: { property_id?, contact_id? }
// Returns the signer roles found in this document's fields_snapshot, each with
// an auto-suggested person based on the role's strategy + provided context.
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: doc } = await serviceClient
    .from('documents')
    .select('id, fields_snapshot, property_id, contact_id, created_by')
    .eq('id', id)
    .single()

  if (!doc || doc.created_by !== user.id)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const propertyId = body.property_id ?? doc.property_id ?? null
  const contactId  = body.contact_id  ?? doc.contact_id  ?? null

  // Extract unique signer_role_ids from fields_snapshot
  const snapshot = Array.isArray(doc.fields_snapshot) ? doc.fields_snapshot : []
  const roleIds: string[] = [
    ...new Set(
      snapshot
        .map((f: Record<string, unknown>) => f.signerRoleId ?? f.signer_role_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ]

  if (roleIds.length === 0)
    return NextResponse.json({ roles: [] })

  try {
    const roles = await resolveRoles(roleIds, { userId: user.id, propertyId, contactId })
    return NextResponse.json({ roles })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
