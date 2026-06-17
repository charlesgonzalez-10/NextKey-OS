import { serviceClient } from '@/lib/supabase-service'
import { OWNER_EMAILS } from '@/lib/roles'

export type UserRole = 'owner' | 'admin' | 'user' | 'viewer'

export interface UserProfile {
  id: string
  role: UserRole
  show_admin_tools: boolean
  display_name: string | null
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data } = await serviceClient
    .from('user_profiles')
    .select('id, role, show_admin_tools, display_name')
    .eq('id', userId)
    .single()
  return (data as UserProfile) ?? null
}

/** Server-side gate: role is owner/admin, OR email matches OWNER_EMAILS (fallback). */
export function canAccessAdmin(profile: UserProfile | null, email?: string | null): boolean {
  if (email && OWNER_EMAILS.includes(email.toLowerCase().trim())) return true
  if (!profile) return false
  return profile.role === 'owner' || profile.role === 'admin'
}

/** Nav visibility: must be admin/owner AND have show_admin_tools enabled (or be owner by email). */
export function shouldShowAdminNav(profile: UserProfile | null, email?: string | null): boolean {
  // Owner email without a DB record → always show (ensures access right after migration)
  if (email && OWNER_EMAILS.includes(email.toLowerCase().trim())) {
    // If DB record exists, respect the toggle; if missing, default to showing
    if (!profile) return true
    return profile.show_admin_tools
  }
  if (!profile) return false
  return (profile.role === 'owner' || profile.role === 'admin') && profile.show_admin_tools
}
