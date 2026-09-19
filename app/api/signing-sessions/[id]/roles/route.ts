import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { getSessionWithRoles } from '@/lib/documents/signingService'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

// GET /api/signing-sessions/[id]/roles
// Returns the session with all its signer role assignments + role metadata.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: session } = await serviceClient
    .from('signing_sessions')
    .select('user_id')
    .eq('id', id)
    .single()

  if (!session || session.user_id !== user.id)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const result = await getSessionWithRoles(id)
    return NextResponse.json(result)
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
