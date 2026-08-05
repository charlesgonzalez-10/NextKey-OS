/**
 * RoleResolutionService — auto-suggests a concrete person (name + email) for
 * each signer role in a document, based on the role's auto_suggest strategy.
 *
 * Strategies:
 *   property_owner    → Owner/Seller in contact_properties for this property
 *   deal_buyer        → contact_id passed at generation time, or user profile
 *   assigned_agent    → the authenticated user's profile (always the agent)
 *   title_company     → the user's default title company contact
 *   relationship_service → any contact linked to this property (catch-all)
 *   manual            → no suggestion; user must fill in manually
 */
import { serviceClient } from '@/lib/supabase-service'

export interface ResolvedRole {
  signer_role_id: string
  role_name:      string
  color:          string
  auto_suggest:   string | null
  signing_order:  number
  suggestion: {
    name:       string
    email:      string
    phone:      string | null
    contact_id: string | null
  } | null
}

export interface ResolutionContext {
  userId:     string
  propertyId?: string | null
  contactId?:  string | null  // buyer/primary contact at generation time
}

async function suggestPropertyOwner(propertyId: string): Promise<ResolvedRole['suggestion']> {
  const { data } = await serviceClient
    .from('contact_properties')
    .select('contacts(id, name, email, phone)')
    .eq('property_id', propertyId)
    .in('relationship_type', ['Owner', 'Seller', 'owner', 'seller'])
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (data as any)?.contacts
  if (!c?.name || !c?.email) return null
  return { name: c.name, email: c.email, phone: c.phone ?? null, contact_id: c.id }
}

async function suggestDealBuyer(contactId: string | null | undefined, userId: string): Promise<ResolvedRole['suggestion']> {
  if (contactId) {
    const { data } = await serviceClient
      .from('contacts')
      .select('id, name, email, phone')
      .eq('id', contactId)
      .single()
    if (data?.email) return { name: data.name ?? '', email: data.email, phone: data.phone ?? null, contact_id: data.id }
  }
  // Fall back to agent's profile
  const { data: p } = await serviceClient
    .from('user_profiles')
    .select('my_name, my_email, my_phone')
    .eq('id', userId)
    .single()
  if (!p?.my_email) return null
  return { name: p.my_name ?? '', email: p.my_email, phone: p.my_phone ?? null, contact_id: null }
}

async function suggestAgent(userId: string): Promise<ResolvedRole['suggestion']> {
  const { data } = await serviceClient
    .from('user_profiles')
    .select('my_name, my_email, my_phone')
    .eq('id', userId)
    .single()
  if (!data?.my_email) return null
  return { name: data.my_name ?? '', email: data.my_email, phone: data.my_phone ?? null, contact_id: null }
}

async function suggestTitleCompany(userId: string): Promise<ResolvedRole['suggestion']> {
  const { data } = await serviceClient
    .from('title_companies')
    .select('company_name, contact_name, email, phone')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.email) return null
  return {
    name:       data.contact_name ?? data.company_name ?? '',
    email:      data.email,
    phone:      data.phone ?? null,
    contact_id: null,
  }
}

async function suggestRelationship(propertyId: string): Promise<ResolvedRole['suggestion']> {
  const { data } = await serviceClient
    .from('contact_properties')
    .select('contacts(id, name, email, phone)')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (data as any)?.contacts
  if (!c?.email) return null
  return { name: c.name ?? '', email: c.email, phone: c.phone ?? null, contact_id: c.id }
}

/**
 * Given a list of signer_role_ids extracted from a document's fields_snapshot,
 * load the full role records and compute auto-suggested people for each.
 */
export async function resolveRoles(
  roleIds: string[],
  ctx: ResolutionContext,
): Promise<ResolvedRole[]> {
  if (roleIds.length === 0) return []

  const { data: roles } = await serviceClient
    .from('signer_roles')
    .select('id, name, color, auto_suggest, sort_order')
    .in('id', roleIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (!roles?.length) return []

  return Promise.all(roles.map(async (role, idx) => {
    let suggestion: ResolvedRole['suggestion'] = null

    switch (role.auto_suggest) {
      case 'property_owner':
        suggestion = ctx.propertyId ? await suggestPropertyOwner(ctx.propertyId) : null
        break
      case 'deal_buyer':
        suggestion = await suggestDealBuyer(ctx.contactId, ctx.userId)
        break
      case 'assigned_agent':
        suggestion = await suggestAgent(ctx.userId)
        break
      case 'title_company':
        suggestion = await suggestTitleCompany(ctx.userId)
        break
      case 'relationship_service':
        suggestion = ctx.propertyId ? await suggestRelationship(ctx.propertyId) : null
        break
      // 'manual' → null
    }

    return {
      signer_role_id: role.id,
      role_name:      role.name,
      color:          role.color,
      auto_suggest:   role.auto_suggest ?? null,
      signing_order:  idx,
      suggestion,
    }
  }))
}
