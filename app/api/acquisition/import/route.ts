/**
 * POST /api/acquisition/import
 *
 * Unified import endpoint for all acquisition pipelines.
 * Accepts normalized leads + column mapping metadata.
 * Upserts to properties ON CONFLICT folio_number, then upserts leads record.
 * Creates an import_session record for history tracking.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import type { NormalizedLead } from '@/lib/importFramework'
import { generateFolioKey } from '@/lib/importFramework'

export const dynamic = 'force-dynamic'

export interface ImportRequest {
  leads:          NormalizedLead[]
  pipeline:       string           // acquisition_pipeline slug
  county?:        string
  file_name?:     string
  file_size?:     number
  source_type?:   'csv' | 'tsv' | 'excel' | 'manual'
  field_mapping?: Record<string, string>
  session_name?:  string
}

const BATCH = 50

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ImportRequest
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { leads, pipeline, county, file_name, file_size, source_type = 'csv', field_mapping, session_name } = body

  if (!leads?.length) return NextResponse.json({ error: 'No leads provided' }, { status: 400 })
  if (leads.length > 2000) return NextResponse.json({ error: 'Max 2000 leads per import' }, { status: 400 })

  // Determine distress flags from pipeline
  const isPreFC     = pipeline === 'pre-foreclosure'
  const isSurplus   = pipeline === 'surplus-funds'
  const isProbate   = pipeline === 'probate'

  // Create import session record
  const { data: session } = await serviceClient
    .from('import_sessions')
    .insert({
      name:         session_name || `${pipeline} import ${new Date().toLocaleDateString()}`,
      pipeline,
      source_type,
      file_name:    file_name || null,
      file_size:    file_size || null,
      county:       county || null,
      total_rows:   leads.length,
      status:       'running',
      field_mapping: field_mapping || null,
      created_by:   user.id,
    })
    .select('id')
    .single()

  const sessionId = session?.id ?? null

  let imported = 0
  let skipped  = 0
  const errors: { folio: string; message: string }[] = []

  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH)

    const rows = batch
      .filter(l => l.property_address?.trim())
      .map(l => ({
        folio_number:         (l.folio_number?.trim()) || generateFolioKey(l),
        property_address:     l.property_address.trim(),
        city:                 l.city?.trim()   || null,
        state:                l.state?.trim()  || 'FL',
        zip:                  l.zip?.trim()    || null,
        county:               l.county?.trim()?.toLowerCase() || county?.toLowerCase() || null,
        owner_name:           l.owner_name?.trim()         || null,
        legal_description:    l.legal_description?.trim()  || null,
        mailing_address:      l.mailing_address?.trim()    || null,
        phone_1:              l.phone_1?.trim()             || null,
        last_sale_date:       l.last_sale_date             || null,
        surplus_funds_amount: isSurplus ? (l.surplus_funds_amount ?? null) : null,
        foreclosure_amount:   isPreFC   ? (l.foreclosure_amount   ?? null) : null,
        property_type:        l.property_type?.trim()      || null,
        beds:                 l.beds                       ?? null,
        baths:                l.baths                      ?? null,
        living_area:          l.living_area                ?? null,
        year_built:           l.year_built                 ?? null,
        market_value:         l.market_value               ?? null,
        assessed_value:       l.assessed_value             ?? null,
        tax_amount:           l.tax_amount                 ?? null,
        is_foreclosure:       isPreFC,
        is_probate:           isProbate,
        data_source:          `${pipeline}-import`,
        enrichment_src:       'manual',
      }))

    skipped += batch.length - rows.length
    if (!rows.length) continue

    const { data: upserted, error: upsertErr } = await serviceClient
      .from('properties')
      .upsert(rows, { onConflict: 'folio_number', ignoreDuplicates: false })
      .select('id, folio_number')

    if (upsertErr) {
      for (const row of rows) {
        errors.push({ folio: row.folio_number, message: upsertErr.message })
      }
      continue
    }

    imported += (upserted ?? []).length

    // Upsert leads records with pipeline assignment
    if ((upserted ?? []).length > 0) {
      const leadRows = (upserted ?? []).map(p => ({
        property_id:          p.id,
        pipeline_stage:       'reviewing',
        status:               'reviewing',
        source:               `${pipeline}-import`,
        acquisition_pipeline: pipeline,
        ...(isSurplus ? { surplus_status: 'new' } : {}),
      }))
      void serviceClient
        .from('leads')
        .upsert(leadRows, { onConflict: 'property_id', ignoreDuplicates: true })
        .then(() => {}, () => {})
    }

    // Import note per lead
    const noteRows = (upserted ?? []).flatMap(p => {
      const src = batch.find(l =>
        (l.folio_number?.trim() || generateFolioKey(l)) === p.folio_number
      )
      if (!src) return []
      const parts: string[] = [`📥 ${pipeline.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase())} Import`]
      if (src.surplus_funds_amount)  parts.push(`Surplus Amount: $${src.surplus_funds_amount.toLocaleString('en-US',{minimumFractionDigits:2})}`)
      if (src.foreclosure_amount)    parts.push(`FC Amount: $${src.foreclosure_amount.toLocaleString()}`)
      if (src.case_number)           parts.push(`Case: ${src.case_number}`)
      if (src.last_sale_date)        parts.push(`Sale Date: ${src.last_sale_date}`)
      if (src.legal_description)     parts.push(`Legal: ${src.legal_description.slice(0,120)}`)
      return [{ lead_id: p.id, body: parts.join('\n'), note_type: 'import', author: user.email ?? 'Import', created_by: user.id }]
    })
    if (noteRows.length) {
      void serviceClient.from('lead_notes').insert(noteRows).then(() => {}, () => {})
    }
  }

  // Finalize session
  if (sessionId) {
    void serviceClient
      .from('import_sessions')
      .update({
        imported, skipped,
        errors:      errors.length,
        status:      errors.length === leads.length ? 'failed' : 'complete',
        error_log:   errors.length ? errors.slice(0, 50) : null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .then(() => {}, () => {})
  }

  return NextResponse.json({ imported, skipped, errors, total: leads.length, session_id: sessionId })
}
