/**
 * Palm Beach Bulk Index File Import
 *
 * Accepts a multipart file upload of the Palm Beach Official Records
 * bulk index file (pipe-delimited, $40/year subscription).
 *
 * Flow:
 *   1. Parse the file via palm-beach-bulk.ts → ClerkRecord[]
 *   2. Dedup against existing scraper_leads
 *   3. Enrich with Palm Beach Property Appraiser data (if folio present)
 *   4. Calculate equity
 *   5. Insert into scraper_leads + auto-import to contacts
 *   6. Return { total, created, skipped, errors }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parsePalmBeachBulkFile } from '@/lib/scrapers/palm-beach-bulk'
import { fetchPropertyData } from '@/lib/scrapers/property-appraiser'
import { detectEntityType, calcEquity, isDuplicate } from '@/lib/scrapers/utils'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import type { EnrichedLead } from '@/lib/scrapers/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120  // 2 min; property lookups add latency

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── Parse multipart upload ────────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart request' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // Sanity-check file size (Palm Beach index files are typically 10–200 MB)
  const MAX_BYTES = 300 * 1024 * 1024  // 300 MB hard cap
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (${(file.size / 1e6).toFixed(1)} MB). Max 300 MB.` }, { status: 413 })
  }

  const content = await file.text()
  const { records: clerkRecords, total_rows, skipped_rows, lp_count } = parsePalmBeachBulkFile(content)

  if (clerkRecords.length === 0) {
    return NextResponse.json({
      error: 'No lis pendens records found. Check file format — expected pipe-delimited with DOC_TYPE column.',
      debug: { total_rows, skipped_rows, lp_count },
    }, { status: 422 })
  }

  // ── Create scraper run record ─────────────────────────────────────────────
  const { data: run } = await supabase
    .from('scraper_runs')
    .insert([{ triggered_by: 'bulk-import', status: 'running' }])
    .select()
    .single()

  const runId: string = run?.id || 'bulk-import'
  let newLeads = 0, skipped = 0, errors = 0

  // ── Process each record ───────────────────────────────────────────────────
  for (const record of clerkRecords) {
    try {
      // Dedup check
      const { duplicate } = await isDuplicate(supabase, {
        folio_number: record.folio_number,
        case_number:  record.case_number,
      })
      if (duplicate) { skipped++; continue }

      // Enrich with property appraiser data
      let lead: EnrichedLead = { ...record }
      const paData = await fetchPropertyData('palm-beach', {
        folio:   record.folio_number,
        address: record.property_address,
      })
      if (paData) lead = { ...lead, ...paData }

      // Calculate equity
      const equityData = calcEquity(lead)
      lead = { ...lead, ...equityData }

      // Entity type detection
      lead.entity_type = detectEntityType(lead.owner_name || lead.mortgagor || '')

      // Insert into properties (unified property database)
      const { data: newProperty, error: insertErr } = await supabase.from('properties').insert([{
        scraper_run_id:     runId,
        source:             'scraper',
        county:             'palm-beach',
        data_source:        'Palm Beach Bulk',
        case_number:        lead.case_number,
        file_date:          lead.file_date,
        plaintiff:          lead.plaintiff,
        mortgagor:          lead.mortgagor,
        foreclosure_amount: lead.foreclosure_amount || null,
        lender_name:        lead.lender_name || null,
        foreclosure_type:   lead.foreclosure_type,
        multiple_liens:     lead.multiple_liens,
        folio_number:       lead.folio_number || null,
        owner_name:         lead.owner_name || null,
        property_address:   lead.property_address || null,
        city:               lead.city || null,
        state:              'FL',
        zip:                lead.zip || null,
        beds:               lead.beds || null,
        baths:              lead.baths || null,
        pool:               lead.pool || null,
        waterfront:         lead.waterfront || null,
        gross_area:         lead.gross_area || null,
        living_area:        lead.living_area || null,
        stories:            lead.stories || null,
        lot_size:           lead.lot_size || null,
        zoning:             lead.zoning || null,
        subdivision_name:   lead.subdivision_name || null,
        legal_description:  (lead as { legal_description?: string }).legal_description || null,
        property_type:      lead.property_type || null,
        year_built:         lead.year_built || null,
        homestead:          lead.homestead || false,
        vacant:             lead.vacant || null,
        last_sale_date:     lead.last_sale_date || null,
        sold_price:         lead.sold_price || null,
        assessed_value:     lead.assessed_value || null,
        land_value:         lead.land_value || null,
        build_value:        lead.build_value || null,
        tax_value:          lead.tax_value || null,
        market_value:       lead.market_value || null,
        price_per_sqft:     lead.price_per_sqft || null,
        known_debt:         lead.known_debt || null,
        equity_percentage:  lead.equity_percentage || null,
        equity_dollar_amount: lead.equity_dollar_amount || null,
        equity_tier:        lead.equity_tier || null,
        entity_type:        lead.entity_type,
        is_pre_foreclosure: lead.foreclosure_type === 'P',
        is_auction:         lead.foreclosure_type === 'A',
      }]).select('id').single()

      if (insertErr || !newProperty) {
        console.error(`[bulk-import] Insert error for ${record.case_number}:`, insertErr?.message)
        errors++
        continue
      }

      // Create a lead record
      await supabase.from('leads').insert([{
        property_id: newProperty.id,
        status:      'new',
        source:      'scraper',
      }]).then(({ error }) => {
        if (error) console.warn('[bulk-import] leads insert failed:', error.message)
      })

      newLeads++

    } catch (err) {
      console.error(`[bulk-import] Error processing ${record.case_number}:`, err)
      errors++
    }
  }

  // ── Update run record ─────────────────────────────────────────────────────
  if (run) {
    await supabase.from('scraper_runs').update({
      status:          errors > 0 && newLeads === 0 ? 'failed' : 'completed',
      completed_at:    new Date().toISOString(),
      palm_beach_new:  newLeads,
      palm_beach_skip: skipped,
      palm_beach_err:  errors,
      total_new:       newLeads,
      total_skipped:   skipped,
      total_errors:    errors,
    }).eq('id', runId)
  }

  console.log(`[bulk-import] Done — ${newLeads} new, ${skipped} skipped, ${errors} errors from ${lp_count} LP records`)

  return NextResponse.json({
    total:     lp_count,
    file_rows: total_rows,
    created:   newLeads,
    skipped,
    errors,
  })
}

// NOTE: Auto-import to contacts removed in the unified property architecture.
// Use the "Add to Pipeline" button on the Leads page to create contacts.
