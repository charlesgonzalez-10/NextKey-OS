/**
 * DocumentGenerationService — orchestrates the full generation lifecycle:
 *
 *   1. Load template + resolve which blueprint version to use
 *   2. Fetch the published fields from the current blueprint version
 *   3. Resolve all merge context data (contacts, property, deal, offer, …)
 *   4. Call MergeEngine.fillPdf()
 *   5. Optionally persist a documents record with full provenance metadata
 *
 * Generated documents record:
 *   - blueprint_id          → which template was used
 *   - blueprint_version_id  → exactly which published version
 *   - fields_snapshot       → the exact field positions and types at that version
 *   - merge_data            → the resolved values that were stamped in
 *   - is_immutable = true   → the record is append-only from this point
 */
import { serviceClient } from '@/lib/supabase-service'
import { BlueprintService, type BuilderField } from './blueprintService'
import { buildMergeData, fillPdf, resolveVariable, type MergeContext, type MergeField } from './mergeEngine'

export interface GenerateOptions {
  templateId:      string
  userId:          string
  contactId?:      string
  leadId?:         string   // property_id
  dealId?:         string
  offerId?:        string
  saveAsDocument?: boolean
}

export interface GenerateResult {
  filledPdf:    Uint8Array
  mergeData:    Record<string, string>
  fieldsUsed:   MergeField[]
  versionId:    string | null
  documentId?:  string
  documentName?: string
}

// ─── Data resolution ──────────────────────────────────────────────────────────

async function resolveContext(opts: GenerateOptions): Promise<MergeContext> {
  const { userId, contactId, leadId, dealId, offerId } = opts

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
    contactId
      ? serviceClient.from('contacts').select('id, name, email, phone, address').eq('id', contactId).single()
      : Promise.resolve({ data: null }),

    leadId
      ? serviceClient.from('properties').select('*').eq('id', leadId).single()
      : Promise.resolve({ data: null }),

    dealId
      ? serviceClient.from('deals')
          .select('id, address, offer_price, closing_date, closing_days, earnest_money, inspection_period, additional_deposit, loan_amount, loan_type, expiration_date, seller_contribution, repair_limit, deposit_days')
          .eq('id', dealId).single()
      : Promise.resolve({ data: null }),

    offerId
      ? serviceClient.from('offers').select('*').eq('id', offerId).single()
      : leadId
        ? serviceClient.from('offers')
            .select('*')
            .eq('property_id', leadId)
            .eq('created_by', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),

    serviceClient.from('user_profiles').select('my_name, my_email, my_phone, company_name').eq('id', userId).single(),
    serviceClient.from('contract_settings').select('*').eq('user_id', userId).maybeSingle(),

    serviceClient.from('title_companies')
      .select('company_name, contact_name, email, phone, address')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle(),

    leadId
      ? serviceClient
          .from('contact_properties')
          .select('contacts(id, name, email, phone, address)')
          .eq('property_id', leadId)
          .in('relationship_type', ['Owner', 'Seller', 'owner', 'seller'])
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    leadId
      ? serviceClient.from('leads').select('offer_amount, offer_pct').eq('property_id', leadId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sellerContact = (sellerLinkRes.data as any)?.contacts ?? null
  const settings  = contractSettingsRes.data as Record<string, unknown> | null
  const leadsRow  = leadsRes.data           as Record<string, unknown> | null
  const offerRow  = offerRes.data           as Record<string, unknown> | null

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

  return {
    contact:          contactRes.data         ?? null,
    seller:           sellerContact,
    property:         propertyRes.data        ?? null,
    deal:             dealRes.data            ?? null,
    offer:            effectiveOffer,
    profile:          profileRes.data         ?? null,
    contractSettings: settings,
    titleCompany:     titleCompanyRes.data    ?? null,
  }
}

// ─── Field resolution ─────────────────────────────────────────────────────────

function builderToMergeField(f: BuilderField): MergeField {
  return {
    page:         f.page,
    x:            f.x,
    y:            f.y,
    w:            f.w,
    h:            f.h,
    variable:     f.variable,
    defaultValue: f.defaultValue,
    fontSize:     f.fontSize,
    fieldType:    f.fieldType,
    signerRoleId: f.signerRoleId ?? null,
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function generateDocument(opts: GenerateOptions): Promise<GenerateResult> {
  const { templateId, userId, saveAsDocument } = opts

  // 1. Load template
  const { data: tmpl, error: tmplErr } = await serviceClient
    .from('contract_templates')
    .select('*')
    .eq('id', templateId)
    .single()

  if (tmplErr || !tmpl) throw new Error('Template not found')
  if (tmpl.user_id !== userId) throw new Error('Not found')

  // 2. Resolve fields from the current published blueprint version
  let mergeFields: MergeField[] = []
  let versionId: string | null = null

  if (tmpl.current_version_id) {
    const versionFields = await BlueprintService.getVersionFields(tmpl.current_version_id)
    if (versionFields.length > 0) {
      mergeFields = versionFields.map(builderToMergeField)
      versionId   = tmpl.current_version_id
    }
  }

  if (mergeFields.length === 0) throw new Error('Template has no published version — publish a version in the builder before generating')

  // 3. Resolve merge context and build data snapshot
  const ctx       = await resolveContext(opts)
  const mergeData = buildMergeData(ctx)

  // Also resolve any field-level defaultValues that use variable syntax
  for (const f of mergeFields) {
    if (f.variable && !mergeData[f.variable]) {
      const v = resolveVariable(f.variable, ctx)
      if (v) mergeData[f.variable] = v
    }
  }

  // 4. Download source PDF and fill it
  const { data: fileBlob, error: dlErr } = await serviceClient.storage
    .from('documents')
    .download(tmpl.file_path)

  if (dlErr || !fileBlob) throw new Error('Failed to download source PDF')

  const filledPdf = await fillPdf(await fileBlob.arrayBuffer(), mergeFields, mergeData)

  // 5. Persist document record with full provenance
  if (saveAsDocument) {
    const safeName  = (tmpl.name ?? 'document').replace(/[^a-zA-Z0-9_\- ]/g, '')
    const fileName  = `${safeName.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.pdf`
    const path      = `${userId}/${fileName}`

    const { error: upErr } = await serviceClient.storage
      .from('documents')
      .upload(path, Buffer.from(filledPdf), { contentType: 'application/pdf', upsert: false })

    if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

    const { data: doc, error: dbErr } = await serviceClient
      .from('documents')
      .insert({
        name:                `${safeName} - Filled`,
        category:            tmpl.category ?? 'contract',
        status:              'generated',
        pdf_path:            path,
        property_id:         opts.leadId    ?? null,
        lead_id:             opts.leadId    ?? null,
        contact_id:          opts.contactId ?? null,
        deal_id:             opts.dealId    ?? null,
        created_by:          userId,
        // DBE provenance — tracks exactly which version and field positions were used
        blueprint_id:        templateId,
        blueprint_version_id: versionId,
        fields_snapshot:     mergeFields,
        merge_data:          mergeData,
        is_immutable:        true,
      })
      .select('id, name')
      .single()

    if (dbErr || !doc) throw new Error('Failed to save document record')

    return { filledPdf, mergeData, fieldsUsed: mergeFields, versionId, documentId: doc.id, documentName: doc.name }
  }

  return { filledPdf, mergeData, fieldsUsed: mergeFields, versionId }
}
