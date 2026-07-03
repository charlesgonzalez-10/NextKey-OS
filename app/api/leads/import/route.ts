/**
 * POST /api/leads/import
 *
 * Bulk-upserts leads from a parsed import payload.
 * Each record is upserted to the properties table (ON CONFLICT folio_number).
 * After upsert, a note is added to each lead with the source details.
 *
 * Body: { leads: ImportLead[] }
 *
 * Returns: { imported: number; skipped: number; errors: { folio: string; message: string }[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { markModuleRefreshed } from '@/lib/propertyService'

export const dynamic = 'force-dynamic'

export interface ImportLead {
  folio_number:       string
  property_address:   string
  city:               string
  state:              string
  zip:                string
  county?:            string
  legal_description?: string
  owner_name?:        string
  last_sale_date?:    string   // ISO date string
  foreclosure_amount?: number  // surplus amount as number
  note_body?:         string   // auto-generated note to attach
}

const BATCH = 50

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { leads?: ImportLead[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const leads = body.leads ?? []
  if (!leads.length) return NextResponse.json({ error: 'No leads provided' }, { status: 400 })
  if (leads.length > 1000) return NextResponse.json({ error: 'Max 1000 leads per import' }, { status: 400 })

  let imported = 0
  let skipped  = 0
  const errors: { folio: string; message: string }[] = []

  // Process in batches
  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH)

    const rows = batch
      .filter(l => l.folio_number && l.property_address)
      .map(l => ({
        folio_number:       l.folio_number.trim(),
        property_address:   l.property_address.trim(),
        city:               l.city?.trim()  || null,
        state:              l.state?.trim() || 'FL',
        zip:                l.zip?.trim()   || null,
        county:             l.county?.trim()?.toLowerCase() || 'lee',
        legal_description:  l.legal_description?.trim() || null,
        owner_name:         l.owner_name?.trim() || null,
        last_sale_date:       l.last_sale_date || null,
        surplus_funds_amount: l.foreclosure_amount ?? null,
        foreclosure_amount:   null,
        is_foreclosure:       true,
        data_source:        'surplus-funds-import',
        enrichment_src:     'manual',
        enriched_at:        null,
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

    // Seed property_freshness so first workspace open doesn't trigger redundant API calls
    void Promise.all(
      (upserted ?? []).map(p =>
        markModuleRefreshed(p.id, 'ownership', 'manual-import')
      )
    ).catch(() => {})

    // Upsert lead records (pipeline stage lives on leads, not properties)
    if ((upserted ?? []).length > 0) {
      const leadRows = (upserted ?? []).map(p => ({
        property_id:    p.id,
        pipeline_stage: 'reviewing',
        status:         'reviewing',
        source:         'surplus-funds-import',
      }))
      void serviceClient
        .from('leads')
        .upsert(leadRows, { onConflict: 'property_id', ignoreDuplicates: true })
        .then(() => {}, () => {})
    }

    // Add notes for each successfully upserted lead
    const noteRows = (upserted ?? [])
      .flatMap(p => {
        const src = batch.find(l => l.folio_number.trim() === p.folio_number)
        if (!src?.note_body) return []
        return [{
          lead_id:    p.id,
          body:       src.note_body,
          note_type:  'import',
          author:     user.email ?? 'Import',
          created_by: user.id,
        }]
      })

    if (noteRows.length) {
      void serviceClient.from('lead_notes').insert(noteRows).then(() => {}, () => {})
    }
  }

  return NextResponse.json({ imported, skipped, errors, total: leads.length })
}
