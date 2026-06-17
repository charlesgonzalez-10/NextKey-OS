import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { getUserProfile } from '@/lib/rbac'
import { isOwner } from '@/lib/roles'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only owner can change roles
  const callerProfile = await getUserProfile(user.id)
  if (callerProfile?.role !== 'owner' && !isOwner(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: targetId } = await params
  const body = await req.json()
  const { role } = body

  const validRoles = ['owner', 'admin', 'user', 'viewer']
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  // Prevent demoting yourself (owner)
  if (targetId === user.id && role !== 'owner') {
    return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
  }

  // Upsert profile with new role
  const { data, error } = await serviceClient
    .from('user_profiles')
    .upsert({
      id:         targetId,
      role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .select('id, role, show_admin_tools')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
