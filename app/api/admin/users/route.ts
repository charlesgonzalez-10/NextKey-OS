import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import { isOwner } from '@/lib/roles'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getUserProfile(user.id)

  // Owner-only endpoint (not just admin)
  if (profile?.role !== 'owner' && !isOwner(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!canAccessAdmin(profile, user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: authData, error: authError } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  const { data: profiles } = await serviceClient
    .from('user_profiles')
    .select('id, role, show_admin_tools, display_name')

  const profileMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [p.id, p]))

  const users = authData.users.map(u => ({
    id:               u.id,
    email:            u.email,
    created_at:       u.created_at,
    last_sign_in_at:  u.last_sign_in_at,
    role:             profileMap.get(u.id)?.role ?? 'user',
    show_admin_tools: profileMap.get(u.id)?.show_admin_tools ?? false,
    display_name:     profileMap.get(u.id)?.display_name ?? null,
  }))

  return NextResponse.json({ users })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getUserProfile(user.id)
  if (profile?.role !== 'owner' && !isOwner(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, role = 'user' } = await request.json()
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  // Generate a readable temporary password
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const tempPassword = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

  // Check if user already exists (may have been partially created before)
  const { data: existing } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
  const existingUser = existing?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase())

  let userId: string

  if (existingUser) {
    // User already exists — just reset their password and update the role
    userId = existingUser.id
    const { error: updateError } = await serviceClient.auth.admin.updateUserById(userId, {
      password: tempPassword,
      email_confirm: true,
    })
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }
  } else {
    // Create new user — manually insert profile first to avoid trigger race conditions
    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    })

    if (createError) {
      // Return the raw Supabase error so it's visible for debugging
      console.error('createUser error:', createError)
      return NextResponse.json({ error: `Supabase: ${createError.message}` }, { status: 400 })
    }

    userId = created.user.id
  }

  // Upsert the role — works whether trigger already created the row or not
  const { error: profileError } = await serviceClient.from('user_profiles').upsert({
    id:   userId,
    role: role,
    show_admin_tools: false,
  }, { onConflict: 'id' })

  if (profileError) {
    console.error('profile upsert error:', profileError)
    // Non-fatal — user was created, role just didn't save
  }

  return NextResponse.json({ success: true, email, tempPassword })
}
