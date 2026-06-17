// ─── Variable Library ─────────────────────────────────────────────────────────

export type VarCategory = 'contact' | 'property' | 'deal' | 'contract' | 'company' | 'user'

export interface VariableDef {
  key:         string       // e.g. "Contact.FirstName"
  label:       string       // e.g. "First Name"
  category:    VarCategory
  description: string
  example:     string
}

export const VARIABLE_LIBRARY: VariableDef[] = [
  // ── Contact ────────────────────────────────────────────────────────────────
  { key: 'Contact.FirstName', label: 'First Name',   category: 'contact',  description: 'Contact first name',            example: 'John'              },
  { key: 'Contact.LastName',  label: 'Last Name',    category: 'contact',  description: 'Contact last name',             example: 'Smith'             },
  { key: 'Contact.FullName',  label: 'Full Name',    category: 'contact',  description: 'Contact full name',             example: 'John Smith'        },
  { key: 'Contact.Phone',     label: 'Phone',        category: 'contact',  description: 'Contact phone number',          example: '(305) 555-0100'    },
  { key: 'Contact.Email',     label: 'Email',        category: 'contact',  description: 'Contact email address',         example: 'john@email.com'    },
  { key: 'Contact.Source',    label: 'Source',       category: 'contact',  description: 'How the contact was found',     example: 'Driving for Dollars'},
  { key: 'Contact.Stage',     label: 'Stage',        category: 'contact',  description: 'Lead score or stage',           example: 'Hot'               },
  // ── Property ───────────────────────────────────────────────────────────────
  { key: 'Property.Address',   label: 'Address',      category: 'property', description: 'Full property address',         example: '2806 N 46th Ave'   },
  { key: 'Property.City',      label: 'City',         category: 'property', description: 'Property city',                 example: 'Hollywood'         },
  { key: 'Property.State',     label: 'State',        category: 'property', description: 'Property state',                example: 'FL'                },
  { key: 'Property.Zip',       label: 'Zip',          category: 'property', description: 'Property zip code',             example: '33021'             },
  { key: 'Property.County',    label: 'County',       category: 'property', description: 'Property county',               example: 'Broward'           },
  { key: 'Property.Bedrooms',  label: 'Bedrooms',     category: 'property', description: 'Number of bedrooms',            example: '3'                 },
  { key: 'Property.Bathrooms', label: 'Bathrooms',    category: 'property', description: 'Number of bathrooms',           example: '2'                 },
  { key: 'Property.SqFt',      label: 'Sq Ft',        category: 'property', description: 'Living area square footage',    example: '1,450'             },
  { key: 'Property.Value',     label: 'Market Value', category: 'property', description: 'Estimated market value',        example: '$285,000'          },
  { key: 'Property.Equity',    label: 'Equity %',     category: 'property', description: 'Equity percentage',             example: '45%'               },
  // ── Deal ───────────────────────────────────────────────────────────────────
  { key: 'Deal.Name',           label: 'Deal Name',      category: 'deal', description: 'Deal address or name',         example: '2806 N 46th Ave'   },
  { key: 'Deal.Stage',          label: 'Stage',          category: 'deal', description: 'Deal stage / status',          example: 'Under Contract'    },
  { key: 'Deal.OfferPrice',     label: 'Offer Price',    category: 'deal', description: 'Offer price',                  example: '$145,000'          },
  { key: 'Deal.CloseDate',      label: 'Close Date',     category: 'deal', description: 'Target closing date',          example: 'July 15, 2026'     },
  { key: 'Deal.InspectionDays', label: 'Inspection Days',category: 'deal', description: 'Inspection period in days',    example: '10'                },
  { key: 'Deal.EarnestMoney',   label: 'Earnest Money',  category: 'deal', description: 'Earnest money deposit',        example: '$1,000'            },
  // ── Contract ───────────────────────────────────────────────────────────────
  { key: 'Contract.PurchasePrice',    label: 'Purchase Price',    category: 'contract', description: 'Contract purchase price',        example: '$145,000'          },
  { key: 'Contract.EMD',              label: 'Earnest Money',     category: 'contract', description: 'Earnest money deposit amount',   example: '$1,000'            },
  { key: 'Contract.ClosingDate',      label: 'Closing Date',      category: 'contract', description: 'Contract closing date',          example: 'July 15, 2026'     },
  { key: 'Contract.InspectionPeriod', label: 'Inspection Period', category: 'contract', description: 'Inspection period',              example: '10 days'           },
  { key: 'Contract.TitleCompany',     label: 'Title Company',     category: 'contract', description: 'Closing title company name',     example: 'Broward Title Co.' },
  // ── Company ────────────────────────────────────────────────────────────────
  { key: 'Company.Name',    label: 'Company Name', category: 'company', description: 'Your company or entity name', example: 'NextKey Property Solutions' },
  { key: 'Company.Phone',   label: 'Phone',        category: 'company', description: 'Company phone number',        example: '(305) 555-0100'             },
  { key: 'Company.Email',   label: 'Email',        category: 'company', description: 'Company email address',       example: 'info@nextkeyps.com'         },
  { key: 'Company.Website', label: 'Website',      category: 'company', description: 'Company website',             example: 'nextkeyps.com'              },
  { key: 'Company.Address', label: 'Address',      category: 'company', description: 'Company mailing address',     example: '123 Office Blvd, Miami FL'  },
  // ── User ───────────────────────────────────────────────────────────────────
  { key: 'User.FirstName', label: 'First Name', category: 'user', description: 'Your first name',       example: 'Charles'               },
  { key: 'User.LastName',  label: 'Last Name',  category: 'user', description: 'Your last name',        example: 'Gonzalez'              },
  { key: 'User.Phone',     label: 'Phone',      category: 'user', description: 'Your phone number',     example: '(305) 555-0100'        },
  { key: 'User.Email',     label: 'Email',      category: 'user', description: 'Your email address',    example: 'charles@nextkeyps.com' },
  { key: 'User.Signature', label: 'Signature',  category: 'user', description: 'Your saved HTML email signature', example: '<em>Charles Gonzalez</em>' },
]

export const CATEGORY_META: Record<VarCategory, { label: string; color: string }> = {
  contact:  { label: 'Contact',  color: '#4ACF9A' },
  property: { label: 'Property', color: '#38bdf8' },
  deal:     { label: 'Deal',     color: '#C9A84C' },
  contract: { label: 'Contract', color: '#818cf8' },
  company:  { label: 'Company',  color: '#fb923c' },
  user:     { label: 'User',     color: '#f472b6' },
}

// ─── Context ──────────────────────────────────────────────────────────────────

export interface TemplateContext {
  contact?:         Record<string, unknown>
  property?:        Record<string, unknown>
  deal?:            Record<string, unknown>
  document?:        Record<string, unknown>  // most recent linked document
  contractSettings?: Record<string, unknown>
  titleCompany?:    Record<string, unknown>
  user?:            { my_name?: string; my_phone?: string; my_email?: string; company_name?: string; signature_data?: string }
  signature?:       string                  // HTML email signature content
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

const fmt$ = (n: unknown) => n ? '$' + Number(n).toLocaleString() : ''
const fmtDate = (s: unknown) => {
  if (!s) return ''
  const d = new Date(String(s))
  return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function resolveNew(category: string, field: string, ctx: TemplateContext): string {
  const c = ctx.contact  as Record<string, unknown> | undefined
  const p = ctx.property as Record<string, unknown> | undefined
  const d = ctx.deal     as Record<string, unknown> | undefined
  const doc = ctx.document as Record<string, unknown> | undefined
  const cs  = ctx.contractSettings as Record<string, unknown> | undefined
  const tc  = ctx.titleCompany     as Record<string, unknown> | undefined
  const u   = ctx.user

  switch (category) {
    case 'Contact': {
      if (!c) return ''
      const name = String(c.name ?? '')
      const parts = name.trim().split(/\s+/)
      switch (field) {
        case 'FirstName': return parts[0] ?? ''
        case 'LastName':  return parts.length > 1 ? parts[parts.length - 1] : ''
        case 'FullName':  return name
        case 'Phone':     return String(c.phone ?? '')
        case 'Email':     return String(c.email ?? '')
        case 'Source':    return String(c.source ?? '')
        case 'Stage':     return String(c.lead_score ?? c.status ?? '')
      }
      break
    }
    case 'Property': {
      if (!p) return ''
      switch (field) {
        case 'Address':   return String(p.property_address ?? p.address ?? '')
        case 'City':      return String(p.city ?? '')
        case 'State':     return String(p.owner_state ?? 'FL')
        case 'Zip':       return String(p.zip ?? '')
        case 'County':    return String(p.county ?? '')
        case 'Bedrooms':  return String(p.beds ?? '')
        case 'Bathrooms': return String(p.baths ?? '')
        case 'SqFt':      return p.living_area ? Number(p.living_area).toLocaleString() : ''
        case 'Value':     return fmt$(p.market_value ?? p.assessed_value)
        case 'Equity':    return p.equity_percentage ? `${p.equity_percentage}%` : ''
      }
      break
    }
    case 'Deal': {
      if (!d) return ''
      switch (field) {
        case 'Name':           return String(d.address ?? '')
        case 'Stage':
        case 'Status':         return String(d.status ?? '')
        case 'OfferPrice':     return fmt$(d.offer_price)
        case 'CloseDate':      return fmtDate(d.closing_date)
        case 'InspectionDays': return String(cs?.inspection_days ?? '10')
        case 'EarnestMoney':   return fmt$(d.earnest_money ?? cs?.earnest_money_amount)
      }
      break
    }
    case 'Contract': {
      const fd = doc?.filled_data as Record<string, string> | undefined
      switch (field) {
        case 'PurchasePrice':    return fd?.offer_amount ? fmt$(fd.offer_amount) : fmt$(d?.offer_price)
        case 'EMD':              return fd?.earnest_money ? fmt$(fd.earnest_money) : fmt$(cs?.earnest_money_amount)
        case 'ClosingDate':      return fd?.closing_date ?? fmtDate(d?.closing_date) ?? ''
        case 'InspectionPeriod': return fd?.inspection_period ? `${fd.inspection_period} days` : `${cs?.inspection_days ?? 10} days`
        case 'TitleCompany':     return String(tc?.company_name ?? cs?.closing_location ?? '')
      }
      break
    }
    case 'Company': {
      switch (field) {
        case 'Name':    return String(cs?.company_name ?? u?.company_name ?? '')
        case 'Phone':   return String(cs?.phone ?? u?.my_phone ?? '')
        case 'Email':   return String(cs?.email ?? u?.my_email ?? '')
        case 'Website': return String(cs?.website ?? '')
        case 'Address': return String(cs?.mailing_address ?? '')
      }
      break
    }
    case 'User': {
      const myNameParts = (u?.my_name ?? '').trim().split(/\s+/)
      switch (field) {
        case 'FirstName': return myNameParts[0] ?? ''
        case 'LastName':  return myNameParts.length > 1 ? myNameParts[myNameParts.length - 1] : ''
        case 'Phone':     return u?.my_phone ?? ''
        case 'Email':     return u?.my_email ?? ''
        case 'Signature': return ctx.signature ?? ''
      }
      break
    }
  }
  return ''
}

// Legacy variable aliases (old-style {{seller_name}}, {{my_name}}, etc.)
function resolveLegacy(key: string, ctx: TemplateContext): string {
  const c  = ctx.contact  as Record<string, unknown> | undefined
  const p  = ctx.property as Record<string, unknown> | undefined
  const d  = ctx.deal     as Record<string, unknown> | undefined
  const u  = ctx.user
  const cs = ctx.contractSettings as Record<string, unknown> | undefined

  switch (key) {
    case 'seller_name':      return String(c?.name ?? p?.owner_name ?? '')
    case 'seller_phone':     return String(c?.phone ?? '')
    case 'seller_email':     return String(c?.email ?? '')
    case 'buyer_name':       return String(cs?.buyer_name ?? u?.my_name ?? '')
    case 'property_address': return String(p?.property_address ?? p?.address ?? d?.address ?? '')
    case 'offer_amount':
    case 'purchase_price':   return d?.offer_price ? '$' + Number(d.offer_price).toLocaleString() : ''
    case 'earnest_money':
    case 'earnest_amount':   return cs?.earnest_money_amount ? '$' + Number(cs.earnest_money_amount).toLocaleString() : ''
    case 'closing_date':     return fmtDate(d?.closing_date)
    case 'closing_location': return String(cs?.closing_location ?? '')
    case 'expiration_date':  { const e = new Date(); e.setDate(e.getDate() + Number(cs?.acceptance_days ?? 3)); return fmtDate(e.toISOString()) }
    case 'my_name':          return u?.my_name  ?? ''
    case 'my_phone':         return u?.my_phone ?? ''
    case 'my_email':         return u?.my_email ?? ''
    case 'company_name':     return String(cs?.company_name ?? u?.company_name ?? '')
    case 'name':             return String(c?.name ?? '')
    case 'subject_topic':    return ''
    case 'showing_date':
    case 'showing_time':
    case 'earnest_deadline':
    case 'inspection_period':
    case 'funds_due':        return ''
    default:                 return ''
  }
}

// ─── Main resolution function ─────────────────────────────────────────────────

/**
 * Resolve all {{variables}} in a template subject or body.
 * Returns the resolved string. Unknown variables are left as-is.
 */
export function resolveTemplate(content: string, ctx: TemplateContext): string {
  return content.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const k = key.trim()
    if (k.includes('.')) {
      const [cat, field] = k.split('.', 2)
      const resolved = resolveNew(cat, field, ctx)
      return resolved !== '' ? resolved : match
    }
    const resolved = resolveLegacy(k, ctx)
    return resolved !== '' ? resolved : match
  })
}

/**
 * Extract all {{variable}} keys from a template string.
 */
export function extractTemplateVars(content: string): string[] {
  const matches = content.matchAll(/\{\{([^}]+)\}\}/g)
  const keys = new Set<string>()
  for (const m of matches) keys.add(m[1].trim())
  return [...keys]
}

/**
 * After resolving, find variables that still contain {{...}} — i.e. unresolved.
 */
export function findMissingVars(resolved: string): string[] {
  const matches = resolved.matchAll(/\{\{([^}]+)\}\}/g)
  const missing = new Set<string>()
  for (const m of matches) missing.add(m[1].trim())
  return [...missing]
}

/**
 * Given a variable key like "Contact.FirstName", return its metadata.
 */
export function getVarDef(key: string): VariableDef | undefined {
  return VARIABLE_LIBRARY.find(v => v.key === key)
}

/**
 * Format a variable key for human display, e.g. "Contact.FirstName" → "Contact First Name"
 */
export function varLabel(key: string): string {
  if (key.includes('.')) {
    const [cat, field] = key.split('.', 2)
    return `${cat} ${field.replace(/([A-Z])/g, ' $1').trim()}`
  }
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
