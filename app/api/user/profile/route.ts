import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { canAccessAdmin } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await serviceClient
    .from('user_profiles')
    .select('id, role, show_admin_tools, display_name, dashboard_config, my_name, my_phone, my_email, company_name')
    .eq('id', user.id)
    .single()

  if (error || !data) {
    // Profile missing — return minimal defaults
    return NextResponse.json({ id: user.id, role: 'user', show_admin_tools: false, display_name: null, dashboard_config: null, my_name: null, my_phone: null, my_email: null, company_name: null })
  }

  return NextResponse.json(data)
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { show_admin_tools, display_name, dashboard_config } = body

  // Fetch current profile to verify they're allowed to toggle admin tools
  const { data: profile } = await serviceClient
    .from('user_profiles')
    .select('role, show_admin_tools')
    .eq('id', user.id)
    .single()

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof show_admin_tools === 'boolean') {
    // Only admin/owner can toggle admin tools
    if (!canAccessAdmin(profile as never, user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    updates.show_admin_tools = show_admin_tools
  }

  if (typeof display_name === 'string') {
    updates.display_name = display_name.trim() || null
  }

  if (dashboard_config !== undefined && dashboard_config !== null) {
    updates.dashboard_config = dashboard_config
  }

  const { data, error } = await serviceClient
    .from('user_profiles')
    .update(updates)
    .eq('id', user.id)
    .select('id, role, show_admin_tools, display_name, dashboard_config, my_name, my_phone, my_email, company_name')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
