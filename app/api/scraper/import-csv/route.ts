/**
 * REIFax CSV import endpoint
 * POST with multipart/form-data containing a 'file' field
 */

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { parseREIFaxCSV } from '@/lib/scrapers/csv-import'
import { isDuplicate } from '@/lib/scrapers/utils'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role to bypass RLS for inserts
  const serviceSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const csvText = await file.text()
    const parsed = parseREIFaxCSV(csvText)

    let created = 0
    let skipped = 0
    let errors = 0
    const skipLog: { reason: string; address?: string }[] = []
    const errorLog: { reason: string; address?: string }[] = []

    // Create a CSV import run record
    const { data: run } = await serviceSupabase
      .from('scraper_runs')
      .insert([{
        triggered_by: 'csv-import',
        status: 'running',
        notes: `CSV import: ${file.name} (${parsed.total} rows)`,
      }])
      .select('id')
      .single()

    const runId = run?.id

    for (const lead of parsed.leads) {
      try {
        // Dedup check
        const { duplicate, reason } = await isDuplicate(serviceSupabase, {
          folio_number: lead.folio_number,
          case_number: lead.case_number,
        })

        if (duplicate) {
          skipped++
          skipLog.push({ reason: reason || 'Duplicate', address: lead.property_address })
          continue
        }

        // Insert to scraper_leads
        await serviceSupabase.from('scraper_leads').insert([{
          scraper_run_id:     runId,
          status:             'pending',
          county:             lead.county,
          case_number:        lead.case_number,
          file_date:          lead.file_date,
          plaintiff:          lead.plaintiff,
          mortgagor:          lead.mortgagor,
          foreclosure_amount: lead.foreclosure_amount || null,
          lender_name:        lead.lender_name || null,
          foreclosure_type:   lead.foreclosure_type,
          auction_date:       lead.auction_date || null,
          auction_amount:     lead.auction_amount || null,
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
          gross_area:         lead.gross_area || null,
          living_area:        lead.living_area || null,
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
          subdivision_name:   lead.subdivision_name || null,
          property_type:      lead.property_type || null,
          phone_1:            lead.phone_1 || null,
          phone_2:            lead.phone_2 || null,
          phone_3:            lead.phone_3 || null,
          phone_4:            lead.phone_4 || null,
          phone_5:            lead.phone_5 || null,
        }])

        // Auto-import to contacts
        const countyName = lead.county === 'miami-dade' ? 'Miami-Dade'
          : lead.county === 'broward' ? 'Broward' : 'Palm Beach'

        const tags = ['pre-foreclosure', lead.county]
        if (lead.homestead) tags.push('owner-occupied')
        if (lead.vacant) tags.push('vacant')
        if (lead.multiple_liens) tags.push('multiple-liens')
        if (lead.equity_tier) tags.push(`equity-${lead.equity_tier.toLowerCase()}`)

        await serviceSupabase.from('contacts').insert([{
          name: lead.owner_name || lead.mortgagor || 'Unknown Owner',
          phone: lead.phone_1 || '',
          address: lead.property_address || '',
          category: 'Seller',
          status: 'Active',
          source: `County Records — ${countyName} (CSV Import)`,
          tags,
          notes: [
            `Pre-Foreclosure — ${countyName} County (REIFax Import)`,
            lead.case_number ? `Case: ${lead.case_number}` : '',
            lead.folio_number ? `Folio: ${lead.folio_number}` : '',
            lead.file_date ? `Filed: ${lead.file_date}` : '',
            lead.plaintiff ? `Plaintiff: ${lead.plaintiff}` : '',
            lead.foreclosure_amount ? `Foreclosure Amount: $${lead.foreclosure_amount.toLocaleString()}` : '',
            lead.equity_tier ? `Equity Tier: ${lead.equity_tier}` : '',
          ].filter(Boolean).join('\n'),
        }])

        created++
      } catch (err) {
        errors++
        errorLog.push({ reason: String(err), address: lead.property_address })
      }
    }

    // Update run record
    if (runId) {
      await serviceSupabase.from('scraper_runs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_new: created,
        total_skipped: skipped,
        total_errors: errors,
        skip_log: skipLog,
        error_log: errorLog,
      }).eq('id', runId)
    }

    return NextResponse.json({
      success: true,
      total: parsed.total,
      created,
      skipped,
      errors,
      parse_errors: parsed.errors,
      run_id: runId,
    })
  } catch (err) {
    console.error('CSV import error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
