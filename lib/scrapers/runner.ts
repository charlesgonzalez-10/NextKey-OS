/**
 * Scraper runner — orchestrates all county scrapers
 * Called by the cron job and the manual trigger
 */

import { createClient } from '@supabase/supabase-js'
import type { ClerkRecord, EnrichedLead, ScraperRunResult, County } from './types'
import { fetchPropertyData } from './property-appraiser'
import { scrapeMiamiDadeClerk } from './miami-dade-clerk'
import { scrapeBrowardClerk } from './broward-clerk'
import { scrapePalmBeachClerk } from './palm-beach-clerk'
import { detectEntityType, calcEquity, isDuplicate } from './utils'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Main Run Function ────────────────────────────────────────────────────────

export async function runScraper(
  triggeredBy: 'cron' | 'manual' = 'cron',
  counties: County[] = ['miami-dade', 'broward', 'palm-beach']
): Promise<string> {
  const supabase = getSupabase()

  // Create run record
  const { data: run, error: runErr } = await supabase
    .from('scraper_runs')
    .insert([{ triggered_by: triggeredBy, status: 'running' }])
    .select()
    .single()

  if (runErr || !run) {
    console.error('Failed to create scraper run:', runErr)
    throw new Error('Failed to create scraper run')
  }

  const runId: string = run.id
  const results: Record<County, ScraperRunResult> = {} as Record<County, ScraperRunResult>

  // Run each county scraper
  for (const county of counties) {
    console.log(`Starting ${county} scraper...`)
    try {
      results[county] = await runCountyScraper(supabase, county, runId)
    } catch (err) {
      console.error(`${county} scraper failed:`, err)
      results[county] = {
        county,
        new_leads: 0,
        skipped: 0,
        errors: 1,
        error_log: [{ reason: String(err) }],
        skip_log: [],
      }
    }
  }

  // Aggregate results
  const totalNew     = Object.values(results).reduce((s, r) => s + r.new_leads, 0)
  const totalSkipped = Object.values(results).reduce((s, r) => s + r.skipped, 0)
  const totalErrors  = Object.values(results).reduce((s, r) => s + r.errors, 0)
  const allErrors    = Object.values(results).flatMap(r => r.error_log)
  const allSkipped   = Object.values(results).flatMap(r => r.skip_log)

  // Update run record
  const md = results['miami-dade']
  const bw = results['broward']
  const pb = results['palm-beach']

  await supabase.from('scraper_runs').update({
    status: totalErrors > 0 && totalNew === 0 ? 'failed' : 'completed',
    completed_at: new Date().toISOString(),
    miami_dade_new:  md?.new_leads || 0,
    miami_dade_skip: md?.skipped || 0,
    miami_dade_err:  md?.errors || 0,
    broward_new:     bw?.new_leads || 0,
    broward_skip:    bw?.skipped || 0,
    broward_err:     bw?.errors || 0,
    palm_beach_new:  pb?.new_leads || 0,
    palm_beach_skip: pb?.skipped || 0,
    palm_beach_err:  pb?.errors || 0,
    total_new:     totalNew,
    total_skipped: totalSkipped,
    total_errors:  totalErrors,
    error_log: allErrors,
    skip_log:  allSkipped,
  }).eq('id', runId)

  console.log(`Scraper complete: ${totalNew} new, ${totalSkipped} skipped, ${totalErrors} errors`)
  return runId
}

// ─── County Scraper ───────────────────────────────────────────────────────────

async function runCountyScraper(
  supabase: ReturnType<typeof getSupabase>,
  county: County,
  runId: string
): Promise<ScraperRunResult> {
  const result: ScraperRunResult = {
    county,
    new_leads: 0,
    skipped: 0,
    errors: 0,
    error_log: [],
    skip_log: [],
  }

  // Get raw clerk records
  let clerkRecords: ClerkRecord[] = []
  switch (county) {
    case 'miami-dade': clerkRecords = await scrapeMiamiDadeClerk(); break
    case 'broward':    clerkRecords = await scrapeBrowardClerk(); break
    case 'palm-beach': clerkRecords = await scrapePalmBeachClerk(); break
  }

  console.log(`${county}: processing ${clerkRecords.length} clerk records`)

  // Process each record
  for (const record of clerkRecords) {
    try {
      // Dedup check
      const { duplicate, reason } = await isDuplicate(supabase, {
        folio_number: record.folio_number,
        case_number:  record.case_number,
      })

      if (duplicate) {
        result.skipped++
        result.skip_log.push({
          case_number: record.case_number,
          folio: record.folio_number,
          reason: reason || 'Duplicate',
        })
        continue
      }

      // Enrich with property appraiser data
      let lead: EnrichedLead = { ...record }
      const paData = await fetchPropertyData(county, {
        folio: record.folio_number,
        address: record.property_address,
      })

      if (paData) {
        lead = { ...lead, ...paData }
      }

      // Calculate equity
      const equityData = calcEquity(lead)
      lead = { ...lead, ...equityData }

      // Detect entity type
      const ownerName = lead.owner_name || lead.mortgagor || ''
      lead.entity_type = detectEntityType(ownerName)

      // Insert into scraper_leads
      const { error: insertErr } = await supabase.from('scraper_leads').insert([{
        scraper_run_id:     runId,
        status:             'pending',
        county:             county,
        case_number:        lead.case_number,
        file_date:          lead.file_date,
        plaintiff:          lead.plaintiff,
        mortgagor:          lead.mortgagor,
        foreclosure_amount: lead.foreclosure_amount || null,
        lender_name:        lead.lender_name,
        mortgage_date:      lead.mortgage_date || null,
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
      }])

      if (insertErr) {
        result.errors++
        result.error_log.push({
          case_number: record.case_number,
          reason: insertErr.message,
        })
        continue
      }

      // Auto-import to contacts table
      await importLeadToContact(supabase, lead, county)
      result.new_leads++

    } catch (err) {
      result.errors++
      result.error_log.push({
        case_number: record.case_number,
        reason: String(err),
      })
    }
  }

  return result
}

// ─── Auto-import lead → contacts ─────────────────────────────────────────────

async function importLeadToContact(
  supabase: ReturnType<typeof getSupabase>,
  lead: EnrichedLead,
  county: County
) {
  const countyName = county === 'miami-dade' ? 'Miami-Dade'
    : county === 'broward' ? 'Broward'
    : 'Palm Beach'

  const ownerName = lead.owner_name || lead.mortgagor || 'Unknown Owner'
  const tags = ['pre-foreclosure', county]
  if (lead.homestead) tags.push('owner-occupied')
  if (lead.vacant) tags.push('vacant')
  if (lead.multiple_liens) tags.push('multiple-liens')
  if (lead.equity_tier) tags.push(`equity-${lead.equity_tier.toLowerCase()}`)
  if (lead.entity_type && lead.entity_type !== 'Individual') {
    tags.push(lead.entity_type.toLowerCase().replace(' ', '-'))
  }

  const notesLines = [
    `Pre-Foreclosure — ${countyName} County`,
    `Case: ${lead.case_number}`,
    lead.folio_number ? `Folio: ${lead.folio_number}` : '',
    lead.file_date ? `Filed: ${lead.file_date}` : '',
    lead.plaintiff ? `Plaintiff: ${lead.plaintiff}` : '',
    lead.foreclosure_amount ? `Foreclosure Amount: $${lead.foreclosure_amount.toLocaleString()}` : '',
    lead.equity_tier ? `Equity Tier: ${lead.equity_tier} (${lead.equity_percentage}% / $${lead.equity_dollar_amount?.toLocaleString()})` : '',
    lead.assessed_value ? `Assessed Value: $${lead.assessed_value.toLocaleString()}` : '',
    lead.beds ? `Beds/Baths: ${lead.beds}/${lead.baths}` : '',
    lead.year_built ? `Year Built: ${lead.year_built}` : '',
    lead.subdivision_name ? `Subdivision: ${lead.subdivision_name}` : '',
  ].filter(Boolean).join('\n')

  const { data: contact } = await supabase.from('contacts').insert([{
    name: ownerName,
    phone: lead.phone_1 || '',
    address: lead.property_address || '',
    category: 'Seller',
    status: 'Active',
    source: `County Records — ${countyName}`,
    tags,
    notes: notesLines,
  }]).select('id').single()

  // Link back to scraper_leads
  if (contact) {
    await supabase
      .from('scraper_leads')
      .update({ status: 'imported', imported_to_contact: contact.id })
      .eq('case_number', lead.case_number)
  }
}
