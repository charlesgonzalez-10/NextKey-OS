import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const dynamic = 'force-dynamic'

interface TemplateField {
  id: string
  page: number
  x: number
  y: number
  w: number
  h: number
  variable: string
  label: string
  defaultValue: string
  fontSize: number
}

interface ResolvedData {
  contact: Record<string, string | null> | null
  seller: Record<string, string | null> | null
  property: Record<string, string | null> | null
  deal: Record<string, unknown> | null
  profile: Record<string, string | null> | null
}

function fmt(n: unknown): string {
  const num = Number(n)
  if (!n || isNaN(num) || num === 0) return ''
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtDate(d: unknown): string {
  if (!d || typeof d !== 'string') return ''
  try { return new Date(d).toLocaleDateString('en-US') } catch { return String(d) }
}

function resolveVariable(variable: string, data: ResolvedData): string {
  const offerPrice  = Number(data.deal?.offer_price  ?? 0)
  const earnest     = Number(data.deal?.earnest_money ?? 0)
  const addlDeposit = Number(data.deal?.additional_deposit ?? 0)
  const loanAmt     = Number(data.deal?.loan_amount ?? 0)
  const balance     = offerPrice - earnest - addlDeposit - loanAmt

  switch (variable) {
    // Buyer / Contact — falls back to user profile when no contact selected
    case '{{Contact.FullName}}':    return data.contact?.name    ?? data.profile?.my_name    ?? ''
    case '{{Contact.Email}}':       return data.contact?.email   ?? data.profile?.my_email   ?? ''
    case '{{Contact.Phone}}':       return data.contact?.phone   ?? data.profile?.my_phone   ?? ''
    case '{{Contact.Address}}':     return data.contact?.address ?? ''
    case '{{Buyer.Name2}}':         return ''

    // Seller — pulled from the contact linked to the property (Owner relationship)
    case '{{Seller.Name}}':         return data.seller?.name ?? data.property?.owner_name ?? ''
    case '{{Seller.Name2}}':        return ''
    case '{{Seller.Email}}':        return data.seller?.email ?? ''
    case '{{Seller.Phone}}':        return data.seller?.phone ?? ''

    // Property
    case '{{Property.Address}}':    return data.property?.property_address ?? ''
    case '{{Property.City}}':       return data.property?.city ?? ''
    case '{{Property.State}}':      return data.property?.state ?? ''
    case '{{Property.Zip}}':        return data.property?.zip ?? ''
    case '{{Property.County}}':     return data.property?.county ?? ''
    case '{{Property.Folio}}':      return data.property?.folio_number ?? ''
    case '{{Property.OwnerName}}':  return data.property?.owner_name ?? ''
    case '{{Property.LegalDesc}}':  return data.property?.legal_description ?? ''

    // Deal — price & deposits
    case '{{Deal.OfferPrice}}':         return fmt(data.deal?.offer_price)
    case '{{Deal.EarnestMoney}}':       return fmt(data.deal?.earnest_money)
    case '{{Deal.DepositDays}}':        return String(data.deal?.deposit_days ?? '3')
    case '{{Deal.AdditionalDeposit}}':  return fmt(data.deal?.additional_deposit) || ''
    case '{{Deal.BalanceToClose}}':     return balance > 0 ? fmt(balance) : ''
    case '{{Deal.LoanAmount}}':         return fmt(data.deal?.loan_amount) || ''
    case '{{Deal.LoanType}}':           return String(data.deal?.loan_type ?? 'Cash')

    // Deal — dates & timeline
    case '{{Deal.ClosingDate}}':        return fmtDate(data.deal?.closing_date)
    case '{{Deal.InspectionDays}}':     return String(data.deal?.inspection_period ?? '')
    case '{{Deal.ExpirationDate}}':     return fmtDate(data.deal?.expiration_date)

    // Deal — terms
    case '{{Deal.SellerContribution}}': return fmt(data.deal?.seller_contribution) || ''
    case '{{Deal.RepairLimit}}':        return fmt(data.deal?.repair_limit) || ''

    // Agent
    case '{{Agent.Name}}':          return data.profile?.my_name ?? ''
    case '{{Agent.Email}}':         return data.profile?.my_email ?? ''
    case '{{Agent.Phone}}':         return data.profile?.my_phone ?? ''
    case '{{Agent.License}}':       return ''
    case '{{Agent.Company}}':       return data.profile?.company_name ?? ''

    // Escrow (set as default values in the builder per template)
    case '{{Escrow.Agent}}':        return ''
    case '{{Escrow.Email}}':        return ''
    case '{{Escrow.Phone}}':        return ''
    case '{{Escrow.Address}}':      return ''

    // Dates
    case '{{Date.Today}}':
      return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    case '{{Date.Effective}}':
      return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    default: return ''
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { contact_id, lead_id, deal_id, save_as_document } = body as {
    contact_id?: string; lead_id?: string; deal_id?: string; save_as_document?: boolean
  }

  // Load template
  const { data: tmpl, error: tmplErr } = await serviceClient
    .from('contract_templates')
    .select('*')
    .eq('id', id)
    .single()

  if (tmplErr || !tmpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  if (tmpl.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!tmpl.field_mappings?.length) return NextResponse.json({ error: 'Template has no field mappings' }, { status: 400 })

  // Fetch all related entities in parallel.
  // Seller: look up the contact linked to the property via contact_properties (Owner relationship).
  const [contactRes, propertyRes, dealRes, profileRes, sellerLinkRes] = await Promise.all([
    contact_id
      ? serviceClient.from('contacts').select('id, name, email, phone, address').eq('id', contact_id).single()
      : Promise.resolve({ data: null }),
    lead_id
      ? serviceClient.from('properties')
          .select('id, property_address, city, state, zip, county, folio_number, owner_name, legal_description')
          .eq('id', lead_id).single()
      : Promise.resolve({ data: null }),
    deal_id
      ? serviceClient.from('deals')
          .select('id, address, offer_price, closing_date, earnest_money, inspection_period, additional_deposit, loan_amount, loan_type, expiration_date, seller_contribution, repair_limit, deposit_days')
          .eq('id', deal_id).single()
      : Promise.resolve({ data: null }),
    serviceClient.from('user_profiles').select('my_name, my_email, my_phone, company_name').eq('id', user.id).single(),
    // Pull the contact linked to the property as Owner
    lead_id
      ? serviceClient
          .from('contact_properties')
          .select('contacts(id, name, email, phone, address)')
          .eq('property_id', lead_id)
          .in('relationship_type', ['Owner', 'Seller', 'owner', 'seller'])
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // Extract seller contact from the join result
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sellerContact = (sellerLinkRes.data as any)?.contacts ?? null

  const resolvedData: ResolvedData = {
    contact:  contactRes.data  ?? null,
    seller:   sellerContact,
    property: propertyRes.data ?? null,
    deal:     dealRes.data     ?? null,
    profile:  profileRes.data  ?? null,
  }

  // Download source PDF
  const { data: fileBlob, error: dlErr } = await serviceClient.storage
    .from('documents')
    .download(tmpl.file_path)

  if (dlErr || !fileBlob) return NextResponse.json({ error: 'Failed to download source PDF' }, { status: 500 })

  const pdfBytes = await fileBlob.arrayBuffer()
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const fields: TemplateField[] = tmpl.field_mappings as TemplateField[]

  for (const field of fields) {
    const rawValue = field.defaultValue || resolveVariable(field.variable, resolvedData)
    if (!rawValue) continue

    const pageIndex = Math.max(0, field.page - 1)
    if (pageIndex >= pdfDoc.getPageCount()) continue

    const page = pdfDoc.getPage(pageIndex)
    const { width: pw, height: ph } = page.getSize()
    const fontSize = field.fontSize ?? 11

    // field.y is normalized from TOP; pdf-lib y is from BOTTOM
    const fieldBottomFromBottom = ph * (1 - field.y - field.h)
    const fieldHeightPx = field.h * ph
    const y = fieldBottomFromBottom + (fieldHeightPx - fontSize) / 2

    try {
      page.drawText(rawValue, {
        x: field.x * pw + 4,
        y: Math.max(y, 4),
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth: field.w * pw - 8,
      })
    } catch { /* skip if value can't be drawn */ }
  }

  const filled = await pdfDoc.save()
  const safeName = (tmpl.name ?? 'document').replace(/[^a-zA-Z0-9_\- ]/g, '')

  // ── Save as document record (for e-signature flow) ──────────────────────────
  if (save_as_document) {
    const timestamp = Date.now()
    const fileName  = `${safeName.replace(/\s+/g, '_').toLowerCase()}_${timestamp}.pdf`
    const path      = `${user.id}/${fileName}`

    const { error: upErr } = await serviceClient.storage
      .from('documents')
      .upload(path, Buffer.from(filled), { contentType: 'application/pdf', upsert: false })

    if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

    const { data: doc, error: dbErr } = await serviceClient
      .from('documents')
      .insert({
        name:        `${safeName} - Filled`,
        category:    tmpl.category ?? 'contract',
        status:      'generated',
        pdf_path:    path,
        property_id: lead_id    ?? null,
        lead_id:     lead_id    ?? null,
        contact_id:  contact_id ?? null,
        deal_id:     deal_id    ?? null,
        created_by:  user.id,
      })
      .select('id, name')
      .single()

    if (dbErr || !doc) return NextResponse.json({ error: 'Failed to save document' }, { status: 500 })
    return NextResponse.json({ id: doc.id, name: doc.name })
  }

  // ── Stream for direct download ───────────────────────────────────────────────
  return new NextResponse(Buffer.from(filled), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName} - Filled.pdf"`,
    },
  })
}
