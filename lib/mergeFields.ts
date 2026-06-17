/**
 * Merge Field Engine — auto-fill document templates from DB records.
 *
 * Replaces the hard-coded buildAutoFill() in lib/documents/template-utils.ts.
 * Fetches all source tables in parallel, then maps them to template variables.
 * The merge_field_definitions table is the canonical registry.
 *
 * Usage (server-side, in API routes):
 *   const fill = await buildAutoFill({ userId, propertyId, contactId, dealId })
 *   const pdf  = await generateDocumentPDF({ content: fillTemplate(template.content, fill), ... })
 */

import { serviceClient } from './supabase-service'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutoFillOpts {
  userId:      string
  propertyId?: string | null
  contactId?:  string | null
  dealId?:     string | null
}

export type FillMap = Record<string, string>

// ─── Auto-fill builder ────────────────────────────────────────────────────────

/**
 * Fetch all source data and return a map of {fieldKey → value} ready for
 * template substitution. Missing values are omitted so the template renderer
 * can substitute blanks as appropriate.
 */
export async function buildAutoFill(opts: AutoFillOpts): Promise<FillMap> {
  const { userId, propertyId, contactId, dealId } = opts
  const fill: FillMap = {}

  // Dates (computed, no DB)
  const today       = new Date()
  fill.today         = fmt(today)
  fill.contract_date = fmt(today)

  // Parallel fetches — never throw, just skip if unavailable
  const [profileRow, settingsRow, titleRow, propertyRow, contactRow, dealRow] = await Promise.all([
    fetchOne('user_profiles',     ['my_name', 'my_email', 'my_phone', 'company_name'],          'id',       userId),
    fetchOne('contract_settings', ['buyer_name','company_name','entity_name','broker_name','broker_license','license_number','earnest_money_amount','closing_days','inspection_days','acceptance_days','closing_location','escrow_instructions'], 'user_id', userId),
    fetchDefaultTitle(userId),
    propertyId ? fetchOne('properties', ['property_address','city','state','zip','county','folio_number','legal_description','property_type','owner_name','mailing_address','market_value'], 'id', propertyId) : null,
    contactId  ? fetchOne('contacts',   ['full_name','email','phone'],                          'id', contactId) : null,
    dealId     ? fetchOne('deals',      ['offer_amount','closing_date'],                        'id', dealId)    : null,
  ])

  // User profile
  if (profileRow) {
    set(fill, 'my_name',      profileRow.my_name)
    set(fill, 'my_email',     profileRow.my_email)
    set(fill, 'my_phone',     profileRow.my_phone)
    // company_name from profile is a fallback only if settings doesn't have one
    if (!fill.company_name) set(fill, 'company_name', profileRow.company_name)
  }

  // Contract settings
  if (settingsRow) {
    set(fill, 'buyer_name',         settingsRow.buyer_name)
    set(fill, 'company_name',       settingsRow.company_name)
    set(fill, 'entity_name',        settingsRow.entity_name)
    set(fill, 'broker_name',        settingsRow.broker_name)
    set(fill, 'broker_license',     settingsRow.broker_license)
    set(fill, 'license_number',     settingsRow.license_number)
    set(fill, 'closing_location',   settingsRow.closing_location)
    set(fill, 'escrow_instructions',settingsRow.escrow_instructions)
    if (settingsRow.earnest_money_amount != null) fill.earnest_money   = fmtCurrency(Number(settingsRow.earnest_money_amount))
    if (settingsRow.closing_days   != null)       fill.closing_days    = String(settingsRow.closing_days)
    if (settingsRow.inspection_days != null)      fill.inspection_days = String(settingsRow.inspection_days)
    if (settingsRow.acceptance_days != null)      fill.acceptance_days = String(settingsRow.acceptance_days)
  }

  // Title company (default)
  if (titleRow) {
    set(fill, 'title_company', titleRow.company_name)
    set(fill, 'title_contact', titleRow.contact_name)
    set(fill, 'title_email',   titleRow.email)
    set(fill, 'title_phone',   titleRow.phone)
    set(fill, 'title_address', titleRow.address)
  }

  // Property
  if (propertyRow) {
    set(fill, 'property_address',  propertyRow.property_address)
    set(fill, 'city',              propertyRow.city)
    set(fill, 'state',             propertyRow.state)
    set(fill, 'zip',               propertyRow.zip)
    set(fill, 'county',            propertyRow.county)
    set(fill, 'folio_number',      propertyRow.folio_number)
    set(fill, 'legal_description', propertyRow.legal_description)
    set(fill, 'property_type',     propertyRow.property_type)
    set(fill, 'owner_name',        propertyRow.owner_name)
    set(fill, 'seller_address',    propertyRow.mailing_address)
    if (propertyRow.market_value != null) fill.market_value = fmtCurrency(Number(propertyRow.market_value))
  }

  // Contact (seller or other party)
  if (contactRow) {
    // Don't override owner_name if we already have it from property
    if (!fill.owner_name) set(fill, 'owner_name', contactRow.full_name)
  }

  // Deal
  if (dealRow) {
    if (dealRow.offer_amount != null) fill.offer_amount = fmtCurrency(Number(dealRow.offer_amount))
    if (dealRow.closing_date != null) fill.closing_date = fmt(new Date(String(dealRow.closing_date)))
  }

  return fill
}

// ─── Template rendering ───────────────────────────────────────────────────────

/**
 * Replace all {{variable}} occurrences in a template string with values
 * from the fill map. Unmatched variables become blanks.
 */
export function fillTemplate(content: string, fill: FillMap): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => fill[key] ?? '_______________')
}

/**
 * Return unique variable names found in template content.
 */
export function detectFields(content: string): string[] {
  const matches = content.matchAll(/\{\{(\w+)\}\}/g)
  return [...new Set([...matches].map(m => m[1]))]
}

/**
 * Convert snake_case to Title Case for display labels.
 */
export function fieldLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function set(map: FillMap, key: string, value: unknown) {
  if (value != null && value !== '') map[key] = String(value)
}

function fmt(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtCurrency(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(n)) return String(value)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

async function fetchOne(
  table: string,
  columns: string[],
  matchCol: string,
  matchVal: string
): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await serviceClient
      .from(table)
      .select(columns.join(', '))
      .eq(matchCol, matchVal)
      .maybeSingle()
    return data as Record<string, unknown> | null
  } catch {
    return null
  }
}

async function fetchDefaultTitle(userId: string): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await serviceClient
      .from('title_companies')
      .select('company_name, contact_name, email, phone, address')
      .eq('user_id', userId)
      .eq('is_default', true)
      .maybeSingle()
    return data as Record<string, unknown> | null
  } catch {
    return null
  }
}
