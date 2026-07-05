/**
 * RelationshipService — the single, canonical place that creates or mutates
 * the Property ↔ Contact relationship.
 *
 * Canonical model:
 *
 *   Property ⇅ contact_properties (junction) ⇅ Contact
 *
 * No route handler or UI component should insert into `contact_properties`,
 * `contacts`, or `leads.property_id` back-references directly — everything
 * goes through the functions below so the relationship stays consistent no
 * matter which screen or workflow (Property Workspace, Contact Workspace,
 * Lead Conversion, Skip Trace, CSV Import) triggered it.
 *
 * `lead_contacts` and `contacts.property_id` are legacy mechanisms that used
 * to duplicate this relationship in two other places; they're deprecated and
 * nothing here reads or writes them.
 */
import { serviceClient } from '@/lib/supabase-service'

export interface ContactInput {
  contact_id?: string | null
  name?: string
  phone?: string | null
  email?: string | null
  address?: string | null
  source?: string | null
}

export interface LinkOptions {
  role?: string
  primary?: boolean
  notes?: string | null
  leadId?: string | null
}

export interface PropertyContactPatch {
  relationship_type?: string
  is_primary?: boolean
  notes?: string | null
}

interface ContactRecord {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  address: string | null
}

const DEFAULT_ROLE = 'Owner'

function normPhone(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

function normEmail(email?: string | null): string | null {
  const trimmed = email?.trim().toLowerCase()
  return trimmed || null
}

/** Resolve properties.id → leads.id, auto-creating the lead row if one doesn't exist yet. */
export async function resolveLeadId(propertyId: string): Promise<string | null> {
  const { data: existing } = await serviceClient
    .from('leads')
    .select('id')
    .eq('property_id', propertyId)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await serviceClient
    .from('leads')
    .insert({ property_id: propertyId, status: 'new' })
    .select('id')
    .single()

  if (error || !created) return null
  return created.id
}

/** Find an existing contact that matches by normalized phone, normalized email, or exact name. */
async function findExistingContact(input: ContactInput): Promise<ContactRecord | null> {
  const phone = normPhone(input.phone)
  const email = normEmail(input.email)

  if (phone || email) {
    const orParts: string[] = []
    if (phone) orParts.push(`phone.ilike.%${phone.slice(-10)}%`)
    if (email) orParts.push(`email.ilike.${email}`)

    const { data } = await serviceClient
      .from('contacts')
      .select('id, name, phone, email, address')
      .or(orParts.join(','))
      .limit(25)

    const match = (data ?? []).find(c =>
      (phone && normPhone(c.phone) === phone) ||
      (email && normEmail(c.email) === email)
    )
    if (match) return match as ContactRecord
  }

  if (input.name?.trim()) {
    const target = input.name.trim().toLowerCase()
    const { data } = await serviceClient
      .from('contacts')
      .select('id, name, phone, email, address')
      .ilike('name', input.name.trim())
      .limit(10)

    const exact = (data ?? []).find(c => c.name?.trim().toLowerCase() === target)
    if (exact) return exact as ContactRecord
  }

  return null
}

/**
 * Reuse an existing Contact if one matches (by phone, email, or exact name),
 * filling in any fields it was missing. Otherwise create a new Contact.
 * Never creates a duplicate for a Contact that already exists.
 */
export async function findOrCreateContact(input: ContactInput): Promise<{ id: string; created: boolean }> {
  if (input.contact_id) return { id: input.contact_id, created: false }

  const existing = await findExistingContact(input)
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (!existing.phone && input.phone?.trim())     patch.phone   = input.phone.trim()
    if (!existing.email && input.email?.trim())     patch.email   = input.email.trim()
    if (!existing.address && input.address?.trim()) patch.address = input.address.trim()
    if (Object.keys(patch).length > 0) {
      await serviceClient.from('contacts').update(patch).eq('id', existing.id)
    }
    return { id: existing.id, created: false }
  }

  if (!input.name?.trim()) {
    throw new Error('name is required to create a new contact')
  }

  const { data: created, error } = await serviceClient
    .from('contacts')
    .insert({
      name:    input.name.trim(),
      phone:   input.phone?.trim() || null,
      email:   input.email?.trim() || null,
      address: input.address?.trim() || null,
      source:  input.source ?? 'Property Relationship',
    })
    .select('id')
    .single()

  if (error || !created) throw new Error(error?.message ?? 'Failed to create contact')
  return { id: created.id, created: true }
}

const LINK_SELECT = `
  id, relationship_type, is_primary, notes, created_at, lead_id,
  contact:contact_id (id, name, phone, email, address, category, status)
`

/**
 * Create (or update) the Property ↔ Contact relationship row. This is the one
 * place `contact_properties` gets written to.
 */
export async function linkPropertyContact(propertyId: string, contactId: string, opts: LinkOptions = {}) {
  const role    = opts.role ?? DEFAULT_ROLE
  const primary = opts.primary ?? false
  const leadId  = opts.leadId !== undefined ? opts.leadId : await resolveLeadId(propertyId)

  if (primary) {
    // Only demote existing primaries within the same role so marking a new
    // Primary Owner doesn't strip "primary" from an unrelated Attorney link.
    await serviceClient
      .from('contact_properties')
      .update({ is_primary: false })
      .eq('property_id', propertyId)
      .eq('relationship_type', role)
  }

  const { data, error } = await serviceClient
    .from('contact_properties')
    .upsert({
      contact_id:        contactId,
      property_id:       propertyId,
      lead_id:           leadId,
      relationship_type: role,
      is_primary:        primary,
      notes:             opts.notes ?? null,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'contact_id,property_id,relationship_type' })
    .select(LINK_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function unlinkPropertyContact(propertyId: string, contactId: string, role?: string): Promise<void> {
  let query = serviceClient
    .from('contact_properties')
    .delete()
    .eq('property_id', propertyId)
    .eq('contact_id', contactId)
  if (role) query = query.eq('relationship_type', role)

  const { error } = await query
  if (error) throw new Error(error.message)
}

export async function updatePropertyContactRole(propertyId: string, contactId: string, patch: PropertyContactPatch) {
  let scopeRole = patch.relationship_type
  if (patch.is_primary === true && !scopeRole) {
    const { data: current } = await serviceClient
      .from('contact_properties')
      .select('relationship_type')
      .eq('property_id', propertyId)
      .eq('contact_id', contactId)
      .limit(1)
      .maybeSingle()
    scopeRole = current?.relationship_type
  }

  if (patch.is_primary === true) {
    let clearQuery = serviceClient
      .from('contact_properties')
      .update({ is_primary: false })
      .eq('property_id', propertyId)
    if (scopeRole) clearQuery = clearQuery.eq('relationship_type', scopeRole)
    await clearQuery
  }

  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.relationship_type !== undefined) dbPatch.relationship_type = patch.relationship_type
  if (patch.is_primary        !== undefined) dbPatch.is_primary        = patch.is_primary
  if (patch.notes             !== undefined) dbPatch.notes             = patch.notes

  const { data, error } = await serviceClient
    .from('contact_properties')
    .update(dbPatch)
    .eq('property_id', propertyId)
    .eq('contact_id', contactId)
    .select(LINK_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function getPropertyContacts(propertyId: string) {
  const { data, error } = await serviceClient
    .from('contact_properties')
    .select(LINK_SELECT)
    .eq('property_id', propertyId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getContactProperties(contactId: string) {
  const { data, error } = await serviceClient
    .from('contact_properties')
    .select(`
      id, relationship_type, is_primary, notes, created_at, lead_id,
      property:property_id (
        id, property_address, city, zip, county, beds, baths, living_area, year_built,
        market_value, assessed_value, equity_tier, equity_percentage,
        is_pre_foreclosure, is_probate, is_auction, is_tax_deed, is_divorce
      )
    `)
    .eq('contact_id', contactId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Full "add homeowner" workflow per the relationship rules:
 *   1. Reuse the Contact if one already matches (never duplicate).
 *   2. Create the Property ↔ Contact relationship if missing.
 *   3. Role = Owner; primary = true when this is the property's first owner.
 */
export async function addHomeowner(propertyId: string, input: ContactInput & { primary?: boolean }) {
  const { id: contactId } = await findOrCreateContact(input)

  let primary = input.primary
  if (primary === undefined) {
    const existing = await getPropertyContacts(propertyId)
    primary = !existing.some(c => c.relationship_type === DEFAULT_ROLE)
  }

  return linkPropertyContact(propertyId, contactId, { role: DEFAULT_ROLE, primary })
}

export const RelationshipService = {
  findOrCreateContact,
  linkPropertyContact,
  unlinkPropertyContact,
  updatePropertyContactRole,
  getPropertyContacts,
  getContactProperties,
  resolveLeadId,
  addHomeowner,

  /** RelationshipService.linkPropertyOwner(propertyId, contactId, { primary: true }) */
  linkPropertyOwner(propertyId: string, contactId: string, opts: Omit<LinkOptions, 'role'> = {}) {
    return linkPropertyContact(propertyId, contactId, { ...opts, role: DEFAULT_ROLE })
  },
}
