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
  contact:          Record<string, unknown> | null
  seller:           Record<string, unknown> | null
  property:         Record<string, unknown> | null
  deal:             Record<string, unknown> | null
  /** Canonical offer: from offers table, or synthesized from leads + contractSettings fallback */
  offer:            Record<string, unknown> | null
  profile:          Record<string, unknown> | null
  contractSettings: Record<string, unknown> | null
  titleCompany:     Record<string, unknown> | null
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

function str(v: unknown): string {
  if (v == null) return ''
  return String(v)
}

function resolveVariable(variable: string, data: ResolvedData): string {
  const { property, contact, seller, deal, offer, profile, contractSettings, titleCompany } = data

  // offer → deal priority chain for financial terms
  const offerPrice  = Number(offer?.purchase_price   ?? deal?.offer_price        ?? 0)
  const earnest     = Number(offer?.earnest_money     ?? deal?.earnest_money      ?? 0)
  const addlDeposit = Number(offer?.additional_deposit ?? deal?.additional_deposit ?? 0)
  const loanAmt     = Number(offer?.loan_amount       ?? deal?.loan_amount        ?? 0)
  const balance     = offerPrice - earnest - addlDeposit - loanAmt

  switch (variable) {
    // ── Buyer / Contact ────────────────────────────────────────────────────────
    case '{{Contact.FullName}}':
      return str(contact?.name ?? profile?.my_name)
    case '{{Contact.Email}}':
      return str(contact?.email ?? profile?.my_email)
    case '{{Contact.Phone}}':
      return str(contact?.phone ?? profile?.my_phone)
    case '{{Contact.Address}}':
      return str(contact?.address)
    case '{{Buyer.Name2}}':
      return ''

    // ── Seller ─────────────────────────────────────────────────────────────────
    case '{{Seller.Name}}':
      return str(seller?.name ?? property?.owner_name)
    case '{{Seller.Name2}}':
      return ''
    case '{{Seller.Email}}':
      return str(seller?.email)
    case '{{Seller.Phone}}':
      return str(seller?.phone)

    // ── Property ───────────────────────────────────────────────────────────────
    case '{{Property.Address}}':
      return str(property?.property_address)
    case '{{Property.City}}':
      return str(property?.city)
    case '{{Property.State}}':
      // Properties are always FL; the table has no separate "state" column
      return 'FL'
    case '{{Property.Zip}}':
      return str(property?.zip)
    case '{{Property.County}}':
      return str(property?.county)
    case '{{Property.Folio}}':
      return str(property?.folio_number)
    case '{{Property.OwnerName}}':
      return str(property?.owner_name)
    case '{{Property.LegalDesc}}':
      return str(property?.legal_description)
    case '{{Property.Subdivision}}':
      return str(property?.subdivision_name)
    case '{{Property.Beds}}':
      return str(property?.beds)
    case '{{Property.Baths}}':
      return str(property?.baths)
    case '{{Property.Sqft}}':
      return str(property?.living_area)
    case '{{Property.YearBuilt}}':
      return str(property?.year_built)

    // ── Offer / Deal — price & deposits (offer takes priority) ────────────────
    case '{{Deal.OfferPrice}}':
      return fmt(offerPrice || null)
    case '{{Deal.EarnestMoney}}':
      return fmt(earnest || null)
    case '{{Deal.DepositDays}}':
      return str(offer?.deposit_days ?? deal?.deposit_days ?? contractSettings?.deposit_days ?? '3')
    case '{{Deal.AdditionalDeposit}}':
      return addlDeposit > 0 ? fmt(addlDeposit) : ''
    case '{{Deal.BalanceToClose}}':
      return balance > 0 ? fmt(balance) : ''
    case '{{Deal.LoanAmount}}':
      return loanAmt > 0 ? fmt(loanAmt) : ''
    case '{{Deal.LoanType}}':
      return str(offer?.financing_type ?? deal?.loan_type ?? 'Cash')

    // ── Dates & timeline (offer → deal → computed) ────────────────────────────
    case '{{Deal.ClosingDate}}':
      return fmtDate(offer?.closing_date ?? deal?.closing_date)
    case '{{Deal.InspectionDays}}': {
      const idays = offer?.inspection_days ?? deal?.inspection_period ?? contractSettings?.inspection_days
      return str(idays)
    }
    case '{{Deal.ClosingDays}}': {
      const cdays = offer?.closing_days ?? deal?.closing_days ?? contractSettings?.closing_days ?? 30
      return str(cdays)
    }
    case '{{Deal.ExpirationDate}}':
      return fmtDate(offer?.expiration_date ?? deal?.expiration_date)

    // ── Terms ──────────────────────────────────────────────────────────────────
    case '{{Deal.SellerContribution}}':
      return fmt(offer?.seller_concessions ?? deal?.seller_contribution) || ''
    case '{{Deal.AssignmentFee}}':
      return fmt(offer?.assignment_fee) || ''
    case '{{Deal.RepairLimit}}':
      return fmt(deal?.repair_limit) || ''

    // ── Agent ──────────────────────────────────────────────────────────────────
    case '{{Agent.Name}}':
      return str(profile?.my_name)
    case '{{Agent.Email}}':
      return str(profile?.my_email)
    case '{{Agent.Phone}}':
      return str(profile?.my_phone)
    case '{{Agent.License}}':
      return str(contractSettings?.license_number)
    case '{{Agent.BrokerName}}':
      return str(contractSettings?.broker_name)
    case '{{Agent.Company}}':
      // entity_name is the legal entity; fall back to company_name
      return str(contractSettings?.entity_name ?? contractSettings?.company_name ?? profile?.company_name)

    // ── Escrow / Title Company ─────────────────────────────────────────────────
    case '{{Escrow.Agent}}':
      return str(titleCompany?.company_name ?? contractSettings?.closing_location)
    case '{{Escrow.Email}}':
      return str(titleCompany?.email)
    case '{{Escrow.Phone}}':
      return str(titleCompany?.phone)
    case '{{Escrow.Address}}':
      return str(titleCompany?.address)
    case '{{Escrow.Contact}}':
      return str(titleCompany?.contact_name)

    // ── Dates ──────────────────────────────────────────────────────────────────
    case '{{Date.Today}}':
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
  const { contact_id, lead_id, deal_id, offer_id, save_as_document } = body as {
    contact_id?: string
    lead_id?:    string
    deal_id?:    string
    offer_id?:   string
    save_as_document?: boolean
  }

  // Load template
  const { data: tmpl, error: tmplErr } = await serviceClient
    .from('contract_templates')
    .select('*')
    .eq('id', id)
    .single()

  if (tmplErr || !tmpl)               return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  if (tmpl.user_id !== user.id)       return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!tmpl.field_mappings?.length)   return NextResponse.json({ error: 'Template has no field mappings' }, { status: 400 })

  // Load all business objects in parallel before touching the PDF.
  // Priority note: offer → deal for financial terms; title company is always the user's default.
  const [
    contactRes,
    propertyRes,
    dealRes,
    offerRes,
    profileRes,
    contractSettingsRes,
    titleCompanyRes,
    sellerLinkRes,
    leadsRes,
  ] = await Promise.all([
    // Buyer contact
    contact_id
      ? serviceClient.from('contacts').select('id, name, email, phone, address').eq('id', contact_id).single()
      : Promise.resolve({ data: null }),

    // Property — SELECT * to capture all columns including legal_description, subdivision_name, etc.
    lead_id
      ? serviceClient.from('properties').select('*').eq('id', lead_id).single()
      : Promise.resolve({ data: null }),

    // Deal
    deal_id
      ? serviceClient.from('deals')
          .select('id, address, offer_price, closing_date, closing_days, earnest_money, inspection_period, additional_deposit, loan_amount, loan_type, expiration_date, seller_contribution, repair_limit, deposit_days')
          .eq('id', deal_id).single()
      : Promise.resolve({ data: null }),

    // Offer: explicit id → latest for property → none
    offer_id
      ? serviceClient.from('offers').select('*').eq('id', offer_id).single()
      : lead_id
        ? serviceClient.from('offers')
            .select('*')
            .eq('property_id', lead_id)
            .eq('created_by', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),

    // User profile — name, email, phone, company
    serviceClient.from('user_profiles').select('my_name, my_email, my_phone, company_name').eq('id', user.id).single(),

    // Contract settings — entity, license, broker, timelines, closing location
    serviceClient.from('contract_settings').select('*').eq('user_id', user.id).maybeSingle(),

    // Title company — user's default (ordered by is_default desc, then first)
    serviceClient.from('title_companies')
      .select('company_name, contact_name, email, phone, address')
      .eq('user_id', user.id)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Seller contact via contact_properties join (Owner/Seller relationship)
    lead_id
      ? serviceClient
          .from('contact_properties')
          .select('contacts(id, name, email, phone, address)')
          .eq('property_id', lead_id)
          .in('relationship_type', ['Owner', 'Seller', 'owner', 'seller'])
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // Leads fallback — offer_amount / offer_pct when no offers record exists yet
    lead_id
      ? serviceClient
          .from('leads')
          .select('offer_amount, offer_pct')
          .eq('property_id', lead_id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sellerContact = (sellerLinkRes.data as any)?.contacts ?? null

  // Synthesize effective offer: canonical offers row → leads-based fallback → null
  // The leads fallback covers cases where the offers table doesn't exist yet or the
  // OfferTab has only written to leads.offer_amount (backward-compat path).
  const settings = contractSettingsRes.data as Record<string, unknown> | null
  const leadsRow = leadsRes.data   as Record<string, unknown> | null
  const offerRow = offerRes.data   as Record<string, unknown> | null

  const effectiveOffer: Record<string, unknown> | null = offerRow ?? (
    leadsRow?.offer_amount
      ? {
          purchase_price:  leadsRow.offer_amount,
          offer_pct:       leadsRow.offer_pct,
          earnest_money:   settings?.earnest_money_amount ?? 1000,
          closing_days:    settings?.closing_days ?? 30,
          inspection_days: settings?.inspection_days ?? 10,
          deposit_days:    settings?.deposit_days ?? 3,
          financing_type:  settings?.financing_type ?? 'Cash',
        }
      : null
  )

  const resolvedData: ResolvedData = {
    contact:          contactRes.data      ?? null,
    seller:           sellerContact,
    property:         propertyRes.data     ?? null,
    deal:             dealRes.data         ?? null,
    offer:            effectiveOffer,
    profile:          profileRes.data      ?? null,
    contractSettings: settings,
    titleCompany:     titleCompanyRes.data ?? null,
  }

  // Download source PDF
  const { data: fileBlob, error: dlErr } = await serviceClient.storage
    .from('documents')
    .download(tmpl.file_path)

  if (dlErr || !fileBlob) return NextResponse.json({ error: 'Failed to download source PDF' }, { status: 500 })

  const pdfBytes = await fileBlob.arrayBuffer()
  const pdfDoc   = await PDFDocument.load(pdfBytes)
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica)

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
    const fieldHeightPx         = field.h * ph
    const y                     = fieldBottomFromBottom + (fieldHeightPx - fontSize) / 2

    try {
      page.drawText(rawValue, {
        x:        field.x * pw + 4,
        y:        Math.max(y, 4),
        size:     fontSize,
        font,
        color:    rgb(0, 0, 0),
        maxWidth: field.w * pw - 8,
      })
    } catch { /* skip fields that can't be drawn */ }
  }

  const filled   = await pdfDoc.save()
  const safeName = (tmpl.name ?? 'document').replace(/[^a-zA-Z0-9_\- ]/g, '')

  // ── Save as document record (e-signature flow) ─────────────────────────────
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

  // ── Stream for direct download ─────────────────────────────────────────────
  return new NextResponse(Buffer.from(filled), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName} - Filled.pdf"`,
    },
  })
}
