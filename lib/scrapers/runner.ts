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
  return runScraperFromExistingRun(runId, counties)
}

/**
 * Run the scraper for an already-created scraper_runs record.
 * Used by /api/scraper/run (the fire-and-forget worker Lambda)
 * so the trigger can create the record and return instantly while
 * this function runs to completion in a separate function invocation.
 */
export async function runScraperFromExistingRun(
  runId: string,
  counties: County[] = ['miami-dade', 'broward', 'palm-beach']
): Promise<string> {
  const supabase = getSupabase()
  const results: Record<County, ScraperRunResult> = {} as Record<County, ScraperRunResult>

  // Per-county hard timeout: 150s allows for one CAPTCHA retry (60s × 2 + HTTP).
  // Without this, one hung county blocks the whole 5-min Lambda budget.
  const COUNTY_TIMEOUT_MS = 150_000

  // Wrap each county run with: 1 automatic retry on any CAPTCHA/network error,
  // then graceful degradation (return empty result, not throw) so one bad county
  // never kills the whole run.
  const CAPTCHA_ERRORS = ['UNSOLVABLE', 'timeout', 'isValidSearch', 'CAPTCHA', '2captcha', 'captcha']
  const isCaptchaErr = (err: unknown) => CAPTCHA_ERRORS.some(k => String(err).includes(k))

  const withRetry = async (county: County): Promise<ScraperRunResult> => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await runCountyScraper(supabase, county, runId)
      } catch (err) {
        if (attempt < 2 && isCaptchaErr(err)) {
          console.log(`[${county}] CAPTCHA error attempt ${attempt} — retrying: ${String(err).slice(0, 80)}`)
          continue
        }
        // Graceful degradation: log the error but don't crash the run
        console.error(`[${county}] failed after ${attempt} attempt(s): ${err}`)
        return {
          county,
          new_leads: 0,
          skipped: 0,
          errors: 1,
          error_log: [{ reason: String(err) }],
          skip_log: [],
        }
      }
    }
    return { county, new_leads: 0, skipped: 0, errors: 1, error_log: [{ reason: 'Max CAPTCHA retries exceeded' }], skip_log: [] }
  }

  console.log(`Running ${counties.join(', ')} scrapers in parallel…`)
  const countyResults = await Promise.allSettled(
    counties.map(county =>
      Promise.race([
        withRetry(county),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${county} timed out after 150s`)), COUNTY_TIMEOUT_MS)
        ),
      ])
    )
  )

  counties.forEach((county, i) => {
    const r = countyResults[i]
    if (r.status === 'fulfilled') {
      results[county] = r.value
    } else {
      console.error(`${county} scraper failed:`, r.reason)
      results[county] = {
        county,
        new_leads: 0,
        skipped: 0,
        errors: 1,
        error_log: [{ reason: String(r.reason) }],
        skip_log: [],
      }
    }
  })

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

      // Insert into properties (unified property database)
      const countySourceLabel =
        county === 'miami-dade' ? 'Miami-Dade Clerk' :
        county === 'broward'    ? 'Broward Clerk'    : 'Palm Beach Clerk'
      const { data: newProperty, error: insertErr } = await supabase.from('properties').insert([{
        scraper_run_id:     runId,
        source:             'scraper',
        county:             county,
        data_source:        countySourceLabel,
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
        is_pre_foreclosure: lead.foreclosure_type === 'P',
        is_auction:         lead.foreclosure_type === 'A',
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
      }]).select('id').single()

      if (insertErr || !newProperty) {
        result.errors++
        result.error_log.push({
          case_number: record.case_number,
          reason: insertErr?.message || 'Insert returned no data',
        })
        continue
      }

      // Create a lead record (this property is now in the leads pipeline)
      await supabase.from('leads').insert([{
        property_id: newProperty.id,
        status:      'new',
        source:      'scraper',
      }]).then(({ error }) => {
        if (error) console.warn(`[scraper] leads insert failed for ${newProperty.id}:`, error.message)
      })

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

// NOTE: Auto-import to contacts removed in the unified property architecture.
// Properties flow: Scraper → properties table + leads table
// When Charles wants to work a lead, he clicks "Add to Pipeline" from the
// Leads page, which creates a Contact linked to the property.
