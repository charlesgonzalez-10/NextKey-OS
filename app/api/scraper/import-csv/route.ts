/**
 * REIFax / PropStream CSV import endpoint
 * POST with multipart/form-data:
 *   file   — the CSV
 *   county — optional fallback county (miami-dade | broward | palm-beach)
 *
 * Writes to: properties table + leads table (unified property architecture)
 */

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { parseREIFaxCSV } from '@/lib/scrapers/csv-import'
import { isDuplicate } from '@/lib/scrapers/utils'
import type { County } from '@/lib/scrapers/types'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Service role bypasses RLS
  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    // Optional county fallback — if CSV has no county column
    const fallbackCountyRaw = (formData.get('county') as string | null)?.toLowerCase().trim()
    const fallbackCounty: County | null =
      fallbackCountyRaw === 'miami-dade' ? 'miami-dade' :
      fallbackCountyRaw === 'broward'    ? 'broward'    :
      fallbackCountyRaw === 'palm-beach' ? 'palm-beach' :
      null

    const csvText = await file.text()

    // Detect header row
    const csvKeywords = ['address','city','county','case','plaintiff','defendant','owner','zip','date','name','folio','amount','mortgagor','lender','entry']
    const csvLines = csvText.split('\n').slice(0, 10)
    let headerRowIdx = 0, bestScore = 0
    for (let i = 0; i < csvLines.length; i++) {
      const score = csvKeywords.filter(k => csvLines[i].toLowerCase().includes(k)).length
      if (score > bestScore) { bestScore = score; headerRowIdx = i }
    }
    const headerLine = csvText.split('\n')[headerRowIdx] || ''
    const detectedHeaders = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''))

    const parsed = parseREIFaxCSV(csvText)

    // Apply fallback county to records that defaulted to miami-dade
    if (fallbackCounty) {
      for (const lead of parsed.leads) {
        if (!detectedHeaders.some(h => h.toLowerCase().includes('county'))) {
          lead.county = fallbackCounty
        }
      }
    }

    let created = 0, skipped = 0, errors = 0
    const skipLog:  { reason: string; address?: string }[] = []
    const errorLog: { reason: string; address?: string }[] = []

    // Create scraper_runs record for audit trail
    const { data: run } = await svc
      .from('scraper_runs')
      .insert([{
        triggered_by: 'csv-import',
        status:       'running',
        notes:        `CSV Import: ${file.name} (${parsed.total} rows)`,
      }])
      .select('id')
      .single()

    const runId = run?.id

    for (const lead of parsed.leads) {
      try {
        // Dedup check against properties table
        const { duplicate, reason } = await isDuplicate(svc, {
          folio_number: lead.folio_number,
          case_number:  lead.case_number,
        })
        if (duplicate) {
          skipped++
          skipLog.push({ reason: reason || 'Duplicate', address: lead.property_address })
          continue
        }

        // Insert into properties (unified property database)
        const { data: newProperty, error: insertErr } = await svc.from('properties').insert([{
          scraper_run_id:       runId,
          source:               'csv_import',
          county:               lead.county,
          data_source:          'REIFax CSV',
          case_number:          lead.case_number,
          file_date:            lead.file_date,
          plaintiff:            lead.plaintiff,
          mortgagor:            lead.mortgagor,
          foreclosure_amount:   lead.foreclosure_amount   || null,
          lender_name:          lead.lender_name          || null,
          foreclosure_type:     lead.foreclosure_type,
          auction_date:         lead.auction_date         || null,
          auction_amount:       lead.auction_amount       || null,
          multiple_liens:       lead.multiple_liens,
          is_pre_foreclosure:   lead.foreclosure_type === 'P',
          is_auction:           lead.foreclosure_type === 'A',
          folio_number:         lead.folio_number         || null,
          owner_name:           lead.owner_name           || null,
          property_address:     lead.property_address     || null,
          city:                 lead.city                 || null,
          state:                'FL',
          zip:                  lead.zip                  || null,
          beds:                 lead.beds                 || null,
          baths:                lead.baths                || null,
          pool:                 lead.pool                 || null,
          gross_area:           lead.gross_area           || null,
          living_area:          lead.living_area          || null,
          year_built:           lead.year_built           || null,
          homestead:            lead.homestead            || false,
          vacant:               lead.vacant               || null,
          last_sale_date:       lead.last_sale_date       || null,
          sold_price:           lead.sold_price           || null,
          assessed_value:       lead.assessed_value       || null,
          land_value:           lead.land_value           || null,
          build_value:          lead.build_value          || null,
          tax_value:            lead.tax_value            || null,
          market_value:         lead.market_value         || null,
          price_per_sqft:       lead.price_per_sqft       || null,
          known_debt:           lead.known_debt           || null,
          equity_percentage:    lead.equity_percentage    || null,
          equity_dollar_amount: lead.equity_dollar_amount || null,
          equity_tier:          lead.equity_tier          || null,
          entity_type:          lead.entity_type,
          subdivision_name:     lead.subdivision_name     || null,
          property_type:        lead.property_type        || null,
          phone_1:              lead.phone_1              || null,
          phone_2:              lead.phone_2              || null,
          phone_3:              lead.phone_3              || null,
          phone_4:              lead.phone_4              || null,
          phone_5:              lead.phone_5              || null,
        }]).select('id').single()

        if (insertErr || !newProperty) {
          console.error('[import-csv] Insert error:', insertErr?.message, '| lead:', lead.property_address)
          errors++
          errorLog.push({ reason: insertErr?.message || 'Insert returned no data', address: lead.property_address })
          continue
        }

        // Create a lead record (imported CSV properties are automatically leads)
        await svc.from('leads').insert([{
          property_id: newProperty.id,
          status:      'new',
          source:      'csv_import',
        }]).then(({ error }) => {
          if (error) console.warn('[import-csv] leads insert failed:', error.message)
        })

        created++
      } catch (err) {
        errors++
        errorLog.push({ reason: String(err), address: lead.property_address })
      }
    }

    // Update run record
    if (runId) {
      await svc.from('scraper_runs').update({
        status:         errors > 0 && created === 0 ? 'failed' : 'completed',
        completed_at:   new Date().toISOString(),
        total_new:      created,
        total_skipped:  skipped,
        total_errors:   errors,
        skip_log:       skipLog,
        error_log:      errorLog,
      }).eq('id', runId)
    }

    return NextResponse.json({
      success:       true,
      total:         parsed.total,
      created,
      skipped,
      errors,
      parse_errors:  parsed.errors,
      run_id:        runId,
      debug: {
        detected_headers: detectedHeaders,
        first_error:      errorLog[0]  || null,
        first_skip:       skipLog[0]   || null,
      },
    })
  } catch (err) {
    console.error('[import-csv] Fatal error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
