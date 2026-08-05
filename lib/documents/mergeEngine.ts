/**
 * MergeEngine — pure PDF fill layer, no DB access.
 *
 * Accepts an original PDF, an ordered list of fields, and a flat
 * mergeData map keyed by {{Variable.Key}}, and returns a filled PDF.
 * All data resolution (contacts, property, deals) happens in
 * DocumentGenerationService before calling here.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface MergeField {
  page:          number
  x:             number   // fractional 0–1
  y:             number   // fractional 0–1, measured from TOP
  w:             number   // fractional width
  h:             number   // fractional height
  variable:      string   // e.g. '{{Contact.FullName}}'
  defaultValue:  string
  fontSize:      number
  fieldType:     string   // 'merge_text' | 'signature' | 'initial' | 'date' | 'readonly'
  signerRoleId?: string | null  // required for signature/initial; stored in fields_snapshot for role resolution
}

export interface MergeContext {
  contact:          Record<string, unknown> | null
  seller:           Record<string, unknown> | null
  property:         Record<string, unknown> | null
  deal:             Record<string, unknown> | null
  offer:            Record<string, unknown> | null
  profile:          Record<string, unknown> | null
  contractSettings: Record<string, unknown> | null
  titleCompany:     Record<string, unknown> | null
}

// ─── Variable resolver ────────────────────────────────────────────────────────

function fmt(n: unknown): string {
  const num = Number(n)
  if (!n || isNaN(num) || num === 0) return ''
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtDate(d: unknown): string {
  if (!d || typeof d !== 'string') return ''
  try { return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }
  catch { return String(d) }
}

function str(v: unknown): string { return v == null ? '' : String(v) }

export function resolveVariable(variable: string, ctx: MergeContext): string {
  const { property, contact, seller, deal, offer, profile, contractSettings, titleCompany } = ctx

  const offerPrice  = Number(offer?.purchase_price    ?? deal?.offer_price        ?? 0)
  const earnest     = Number(offer?.earnest_money      ?? deal?.earnest_money      ?? 0)
  const addlDeposit = Number(offer?.additional_deposit ?? deal?.additional_deposit ?? 0)
  const loanAmt     = Number(offer?.loan_amount        ?? deal?.loan_amount        ?? 0)
  const balance     = offerPrice - earnest - addlDeposit - loanAmt

  switch (variable) {
    case '{{Contact.FullName}}': return str(contact?.name ?? profile?.my_name)
    case '{{Contact.Email}}':    return str(contact?.email ?? profile?.my_email)
    case '{{Contact.Phone}}':    return str(contact?.phone ?? profile?.my_phone)
    case '{{Contact.Address}}':  return str(contact?.address)
    case '{{Buyer.Name2}}':      return ''

    case '{{Seller.Name}}':  return str(seller?.name ?? property?.owner_name)
    case '{{Seller.Name2}}': return ''
    case '{{Seller.Email}}': return str(seller?.email)
    case '{{Seller.Phone}}': return str(seller?.phone)

    case '{{Property.Address}}':    return str(property?.property_address)
    case '{{Property.City}}':       return str(property?.city)
    case '{{Property.State}}':      return 'FL'
    case '{{Property.Zip}}':        return str(property?.zip)
    case '{{Property.County}}':     return str(property?.county)
    case '{{Property.Folio}}':      return str(property?.folio_number)
    case '{{Property.OwnerName}}':  return str(property?.owner_name)
    case '{{Property.LegalDesc}}':  return str(property?.legal_description)
    case '{{Property.Subdivision}}':return str(property?.subdivision_name)
    case '{{Property.Beds}}':       return str(property?.beds)
    case '{{Property.Baths}}':      return str(property?.baths)
    case '{{Property.Sqft}}':       return str(property?.living_area)
    case '{{Property.YearBuilt}}':  return str(property?.year_built)

    case '{{Deal.OfferPrice}}':         return fmt(offerPrice || null)
    case '{{Deal.EarnestMoney}}':       return fmt(earnest || null)
    case '{{Deal.DepositDays}}':        return str(offer?.deposit_days ?? deal?.deposit_days ?? contractSettings?.deposit_days ?? '3')
    case '{{Deal.AdditionalDeposit}}':  return addlDeposit > 0 ? fmt(addlDeposit) : ''
    case '{{Deal.BalanceToClose}}':     return balance > 0 ? fmt(balance) : ''
    case '{{Deal.LoanAmount}}':         return loanAmt > 0 ? fmt(loanAmt) : ''
    case '{{Deal.LoanType}}':           return str(offer?.financing_type ?? deal?.loan_type ?? 'Cash')
    case '{{Deal.ClosingDate}}':        return fmtDate(offer?.closing_date ?? deal?.closing_date)
    case '{{Deal.InspectionDays}}':     return str(offer?.inspection_days ?? deal?.inspection_period ?? contractSettings?.inspection_days)
    case '{{Deal.ClosingDays}}':        return str(offer?.closing_days ?? deal?.closing_days ?? contractSettings?.closing_days ?? 30)
    case '{{Deal.ExpirationDate}}':     return fmtDate(offer?.expiration_date ?? deal?.expiration_date)
    case '{{Deal.SellerContribution}}': return fmt(offer?.seller_concessions ?? deal?.seller_contribution) || ''
    case '{{Deal.AssignmentFee}}':      return fmt(offer?.assignment_fee) || ''
    case '{{Deal.RepairLimit}}':        return fmt(deal?.repair_limit) || ''

    case '{{Agent.Name}}':      return str(profile?.my_name)
    case '{{Agent.Email}}':     return str(profile?.my_email)
    case '{{Agent.Phone}}':     return str(profile?.my_phone)
    case '{{Agent.License}}':   return str(contractSettings?.license_number)
    case '{{Agent.BrokerName}}':return str(contractSettings?.broker_name)
    case '{{Agent.Company}}':   return str(contractSettings?.entity_name ?? contractSettings?.company_name ?? profile?.company_name)

    case '{{Escrow.Agent}}':   return str(titleCompany?.company_name ?? contractSettings?.closing_location)
    case '{{Escrow.Email}}':   return str(titleCompany?.email)
    case '{{Escrow.Phone}}':   return str(titleCompany?.phone)
    case '{{Escrow.Address}}': return str(titleCompany?.address)
    case '{{Escrow.Contact}}': return str(titleCompany?.contact_name)

    case '{{Date.Today}}':
    case '{{Date.Effective}}':
      return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    default: return ''
  }
}

/**
 * Build a flat mergeData snapshot keyed by {{Variable.Key}}.
 * Stored on documents.merge_data for reproducibility/audit.
 */
export function buildMergeData(ctx: MergeContext): Record<string, string> {
  const allVariables = [
    '{{Contact.FullName}}', '{{Contact.Email}}', '{{Contact.Phone}}', '{{Contact.Address}}',
    '{{Buyer.Name2}}',
    '{{Seller.Name}}', '{{Seller.Name2}}', '{{Seller.Email}}', '{{Seller.Phone}}',
    '{{Property.Address}}', '{{Property.City}}', '{{Property.State}}', '{{Property.Zip}}',
    '{{Property.County}}', '{{Property.Folio}}', '{{Property.OwnerName}}', '{{Property.LegalDesc}}',
    '{{Property.Subdivision}}', '{{Property.Beds}}', '{{Property.Baths}}', '{{Property.Sqft}}', '{{Property.YearBuilt}}',
    '{{Deal.OfferPrice}}', '{{Deal.EarnestMoney}}', '{{Deal.DepositDays}}', '{{Deal.AdditionalDeposit}}',
    '{{Deal.BalanceToClose}}', '{{Deal.LoanAmount}}', '{{Deal.LoanType}}', '{{Deal.ClosingDate}}',
    '{{Deal.InspectionDays}}', '{{Deal.ClosingDays}}', '{{Deal.ExpirationDate}}',
    '{{Deal.SellerContribution}}', '{{Deal.AssignmentFee}}', '{{Deal.RepairLimit}}',
    '{{Agent.Name}}', '{{Agent.Email}}', '{{Agent.Phone}}', '{{Agent.License}}',
    '{{Agent.BrokerName}}', '{{Agent.Company}}',
    '{{Escrow.Agent}}', '{{Escrow.Email}}', '{{Escrow.Phone}}', '{{Escrow.Address}}', '{{Escrow.Contact}}',
    '{{Date.Today}}', '{{Date.Effective}}',
  ]
  const data: Record<string, string> = {}
  for (const v of allVariables) {
    const val = resolveVariable(v, ctx)
    if (val) data[v] = val
  }
  return data
}

// ─── PDF renderer ─────────────────────────────────────────────────────────────

export async function fillPdf(
  pdfBytes: ArrayBuffer,
  fields: MergeField[],
  mergeData: Record<string, string>,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica)

  for (const field of fields) {
    // Signature/initial/notary_seal fields are never merge-filled here — handled by signing flow
    if (['signature', 'initial', 'notary_seal'].includes(field.fieldType)) continue

    const rawValue = field.defaultValue || mergeData[field.variable] || ''
    if (!rawValue) continue

    const pageIndex = Math.max(0, field.page - 1)
    if (pageIndex >= pdfDoc.getPageCount()) continue

    const page = pdfDoc.getPage(pageIndex)
    const { width: pw, height: ph } = page.getSize()
    const fontSize = field.fontSize || 11

    // field.y is from top; pdf-lib y is from bottom
    const fieldBottomY   = ph * (1 - field.y - field.h)
    const fieldHeightPx  = field.h * ph
    const textY          = fieldBottomY + (fieldHeightPx - fontSize) / 2

    try {
      page.drawText(rawValue, {
        x:        field.x * pw + 4,
        y:        Math.max(textY, 4),
        size:     fontSize,
        font,
        color:    rgb(0, 0, 0),
        maxWidth: field.w * pw - 8,
      })
    } catch { /* skip fields that exceed page bounds */ }
  }

  return pdfDoc.save()
}
