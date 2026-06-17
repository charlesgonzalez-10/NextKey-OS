/** Replace {{variable}} placeholders with values from the data map. */
export function fillTemplate(content: string, data: Record<string, string>): string {
  return content.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const val = data[key.trim()]
    // Unfilled variables → visible blank line for manual completion
    return val ?? '_______________'
  })
}

/** Extract all unique {{variable}} names from a template string. */
export function extractVariables(content: string): string[] {
  const matches = content.matchAll(/\{\{([^}]+)\}\}/g)
  const names = new Set<string>()
  for (const m of matches) names.add(m[1].trim())
  return [...names]
}

/** Human-readable label for a variable key. */
export function variableLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/** Build auto-fill data from linked records. */
export function buildAutoFill(opts: {
  user?:             { email?: string; display_name?: string; my_name?: string; my_phone?: string; my_email?: string; company_name?: string }
  property?:         Record<string, unknown>
  lead?:             Record<string, unknown>
  contact?:          Record<string, unknown>
  deal?:             Record<string, unknown>
  contractSettings?: Record<string, unknown>
  titleCompany?:     Record<string, unknown>
  offerProfile?:     Record<string, unknown>
}): Record<string, string> {
  const { user, property, lead, contact, deal, contractSettings, titleCompany, offerProfile } = opts

  const today = new Date()
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const fmtDate = (s: unknown) => {
    if (!s) return ''
    const d = new Date(String(s))
    return isNaN(d.getTime()) ? String(s) : fmt(d)
  }

  // Days from settings/profile
  const closingDays    = Number(offerProfile?.closing_days    ?? contractSettings?.closing_days    ?? 30)
  const inspectionDays = Number(offerProfile?.inspection_days ?? contractSettings?.inspection_days ?? 10)
  const acceptanceDays = Number(contractSettings?.acceptance_days ?? 3)

  const closingDate = new Date(today)
  closingDate.setDate(closingDate.getDate() + closingDays)
  const expiryDate = new Date(today)
  expiryDate.setDate(expiryDate.getDate() + acceptanceDays)

  // Address: prefer property_address from properties table, fallback to lead/deal address
  const address = String(
    property?.property_address ??
    lead?.address ??
    deal?.address ??
    ''
  )

  // Seller name: contact.name → property owner_name
  const sellerName = String(
    contact?.name ??
    property?.owner_name ??
    lead?.owner_name ??
    ''
  )

  const parcelId = String(
    property?.folio_number ??
    property?.parcel_id ??
    lead?.folio_number ??
    lead?.parcel_id ??
    ''
  )

  // Offer amount: deal → manual
  const offerAmount = deal?.offer_price ? String(deal.offer_price) : ''

  // Earnest money: deal → offerProfile → contractSettings
  const earnest = deal?.earnest_money
    ?? offerProfile?.earnest_money
    ?? contractSettings?.earnest_money_amount
    ?? ''

  // Buyer name: offerProfile → contractSettings → user
  const myName      = user?.my_name ?? user?.display_name ?? user?.email?.split('@')[0] ?? ''
  const myEmail     = user?.my_email ?? user?.email ?? ''
  const myPhone     = user?.my_phone ?? ''
  const companyName = String(contractSettings?.company_name ?? user?.company_name ?? '')
  const buyerName   = String(offerProfile?.buyer_name ?? contractSettings?.buyer_name ?? myName)

  // Closing date: prefer deal closing date, else auto-compute
  const closingDateStr = deal?.closing_date ? fmtDate(deal.closing_date) : fmt(closingDate)

  return {
    date:               fmt(today),
    contract_date:      fmt(today),
    my_name:            myName,
    my_email:           myEmail,
    my_phone:           myPhone,
    company_name:       companyName,
    entity_name:        String(contractSettings?.entity_name ?? ''),
    buyer_name:         buyerName,
    seller_name:        sellerName,
    seller_phone:       String(contact?.phone ?? ''),
    seller_email:       String(contact?.email ?? ''),
    property_address:   address,
    property_city:      String(property?.city ?? ''),
    property_state:     String(property?.owner_state ?? 'FL'),
    property_zip:       String(property?.zip ?? ''),
    county:             String(property?.county ?? lead?.county ?? ''),
    parcel_id:          parcelId,
    legal_description:  String(property?.legal_description ?? ''),
    offer_amount:       offerAmount,
    purchase_price:     offerAmount,
    earnest_money:      earnest ? String(earnest) : '',
    earnest_days:       '3',
    closing_date:       closingDateStr,
    closing_days:       String(closingDays),
    inspection_days:    String(inspectionDays),
    inspection_period:  String(inspectionDays),
    acceptance_days:    String(acceptanceDays),
    expiration_date:    fmt(expiryDate),
    title_company:      String(titleCompany?.company_name ?? contractSettings?.closing_location ?? ''),
    title_contact:      String(titleCompany?.contact_name ?? ''),
    title_email:        String(titleCompany?.email ?? ''),
    title_phone:        String(titleCompany?.phone ?? ''),
    title_address:      String(titleCompany?.address ?? ''),
    broker_name:        String(contractSettings?.broker_name ?? ''),
    license_number:     String(contractSettings?.license_number ?? ''),
    assignee_name:      '',
    assignment_fee:     '',
  }
}
