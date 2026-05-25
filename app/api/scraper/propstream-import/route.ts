/**
 * PropStream CSV Import
 *
 * Accepts a PropStream pre-foreclosure CSV export and runs each record
 * through the standard dedup + equity + entity-type + insert pipeline.
 *
 * Because PropStream already includes property details (beds/baths/value/
 * equity/phones), we skip the Property Appraiser lookup entirely —
 * cutting import time significantly vs. the scraper path.
 *
 * Accepts optional `county` form field as a fallback for rows that have
 * no recognisable County column value.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parsePropStreamCSV } from '@/lib/scrapers/propstream-csv'
import { detectEntityType, calcEquity, isDuplicate } from '@/lib/scrapers/utils'
import type { EnrichedLead, County } from '@/lib/scrapers/types'

export const dynamic    = 'force-dynamic'
export const maxDuration = 120  // 2 min — no PA lookups, so 120s is plenty

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart request' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  if (file.size > 100 * 1024 * 1024) {
    return NextResponse.json(
      { error: `File too large (${(file.size / 1e6).toFixed(1)} MB). Max 100 MB.` },
      { status: 413 }
    )
  }

  // Optional fallback county (sent by the UI county picker)
  const fallbackCountyRaw = (formData.get('county') as string | null)?.toLowerCase().trim()
  const fallbackCounty: County | null =
    fallbackCountyRaw === 'miami-dade' ? 'miami-dade' :
    fallbackCountyRaw === 'broward'    ? 'broward'    :
    fallbackCountyRaw === 'palm-beach' ? 'palm-beach' :
    null

  const content = await file.text()
  const { leads, total_rows, skipped: parseSkipped, lp_count } =
    parsePropStreamCSV(content, fallbackCounty)

  if (leads.length === 0) {
    return NextResponse.json({
      error:
        'No records found. Make sure this is a PropStream pre-foreclosure CSV export. ' +
        'If your export has no County column, select a county from the dropdown before importing.',
      debug: { total_rows, parse_skipped: parseSkipped },
    }, { status: 422 })
  }

  // ── Create scraper run record ─────────────────────────────────────────────
  const { data: run } = await supabase
    .from('scraper_runs')
    .insert([{ triggered_by: 'propstream-import', status: 'running' }])
    .select()
    .single()

  const runId = run?.id || 'propstream-import'
  let newLeads = 0
  let skipped  = parseSkipped
  let errors   = 0

  const countyNew: Record<County, number> = {
    'miami-dade': 0,
    'broward':    0,
    'palm-beach': 0,
  }

  // ── Process records ───────────────────────────────────────────────────────
  for (const lead of leads) {
    try {
      const { duplicate } = await isDuplicate(supabase, {
        folio_number: lead.folio_number,
        case_number:  lead.case_number,
      })
      if (duplicate) { skipped++; continue }

      // Equity — use PropStream's values when present; calculate otherwise
      let finalLead: EnrichedLead = { ...lead }
      if (!finalLead.equity_percentage || !finalLead.equity_dollar_amount) {
        finalLead = { ...finalLead, ...calcEquity(finalLead) }
      }

      finalLead.entity_type = detectEntityType(
        finalLead.owner_name || finalLead.mortgagor || ''
      )

      const { error: insertErr } = await supabase.from('scraper_leads').insert([{
        scraper_run_id:       runId,
        status:               'pending',
        county:               finalLead.county,
        case_number:          finalLead.case_number,
        file_date:            finalLead.file_date,
        plaintiff:            finalLead.plaintiff,
        mortgagor:            finalLead.mortgagor,
        foreclosure_amount:   finalLead.foreclosure_amount   || null,
        lender_name:          finalLead.lender_name          || null,
        mortgage_date:        finalLead.mortgage_date        || null,
        foreclosure_type:     finalLead.foreclosure_type,
        multiple_liens:       finalLead.multiple_liens,
        folio_number:         finalLead.folio_number         || null,
        owner_name:           finalLead.owner_name           || null,
        property_address:     finalLead.property_address     || null,
        city:                 finalLead.city                 || null,
        state:                'FL',
        zip:                  finalLead.zip                  || null,
        beds:                 finalLead.beds                 || null,
        baths:                finalLead.baths                || null,
        living_area:          finalLead.living_area          || null,
        lot_size:             finalLead.lot_size             || null,
        year_built:           finalLead.year_built           || null,
        property_type:        finalLead.property_type        || null,
        homestead:            finalLead.homestead            || false,
        vacant:               finalLead.vacant               ?? null,
        last_sale_date:       finalLead.last_sale_date       || null,
        sold_price:           finalLead.sold_price           || null,
        assessed_value:       finalLead.assessed_value       || null,
        market_value:         finalLead.market_value         || null,
        known_debt:           finalLead.known_debt           || null,
        equity_percentage:    finalLead.equity_percentage    || null,
        equity_dollar_amount: finalLead.equity_dollar_amount || null,
        equity_tier:          finalLead.equity_tier          || null,
        entity_type:          finalLead.entity_type,
        // Phones come from PropStream skip tracing
        phone_1: finalLead.phone_1 || null,
        phone_2: finalLead.phone_2 || null,
        phone_3: finalLead.phone_3 || null,
        phone_4: finalLead.phone_4 || null,
        phone_5: finalLead.phone_5 || null,
      }])

      if (insertErr) {
        console.error(`[propstream-import] Insert error ${lead.case_number}:`, insertErr.message)
        errors++
        continue
      }

      await importToContact(supabase, finalLead)
      countyNew[finalLead.county]++
      newLeads++

    } catch (err) {
      console.error(`[propstream-import] Error processing ${lead.case_number}:`, err)
      errors++
    }
  }

  // ── Update run record ─────────────────────────────────────────────────────
  if (run) {
    await supabase.from('scraper_runs').update({
      status:         errors > 0 && newLeads === 0 ? 'failed' : 'completed',
      completed_at:   new Date().toISOString(),
      miami_dade_new: countyNew['miami-dade'],
      broward_new:    countyNew['broward'],
      palm_beach_new: countyNew['palm-beach'],
      total_new:      newLeads,
      total_skipped:  skipped,
      total_errors:   errors,
    }).eq('id', runId)
  }

  console.log(`[propstream-import] ${newLeads} new, ${skipped} skipped, ${errors} errors (${lp_count} parsed)`)

  return NextResponse.json({
    total:     lp_count,
    file_rows: total_rows,
    created:   newLeads,
    skipped,
    errors,
  })
}

// ─── Auto-import to contacts ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importToContact(supabase: any, lead: EnrichedLead) {
  const countyName =
    lead.county === 'miami-dade' ? 'Miami-Dade' :
    lead.county === 'broward'    ? 'Broward'    : 'Palm Beach'

  const ownerName = lead.owner_name || lead.mortgagor || 'Unknown Owner'

  const tags = ['pre-foreclosure', lead.county, 'propstream']
  if (lead.homestead)      tags.push('owner-occupied')
  if (lead.vacant)         tags.push('vacant')
  if (lead.multiple_liens) tags.push('multiple-liens')
  if (lead.equity_tier)    tags.push(`equity-${lead.equity_tier.toLowerCase()}`)
  if (lead.entity_type && lead.entity_type !== 'Individual') {
    tags.push(lead.entity_type.toLowerCase().replace(' ', '-'))
  }

  const notes = [
    `Pre-Foreclosure — ${countyName} County (PropStream)`,
    `Case: ${lead.case_number}`,
    lead.folio_number       ? `Folio/APN: ${lead.folio_number}` : '',
    lead.file_date          ? `Filed: ${lead.file_date}` : '',
    lead.plaintiff          ? `Plaintiff: ${lead.plaintiff}` : '',
    lead.foreclosure_amount ? `Loan Balance: $${lead.foreclosure_amount.toLocaleString()}` : '',
    lead.equity_tier
      ? `Equity Tier: ${lead.equity_tier} (${lead.equity_percentage?.toFixed(1)}% / $${lead.equity_dollar_amount?.toLocaleString()})`
      : '',
    lead.market_value  ? `Market Value: $${lead.market_value.toLocaleString()}` : '',
    lead.beds          ? `Beds/Baths: ${lead.beds}/${lead.baths}` : '',
    lead.year_built    ? `Year Built: ${lead.year_built}` : '',
  ].filter(Boolean).join('\n')

  const { data: contact } = await supabase
    .from('contacts')
    .insert([{
      name:     ownerName,
      phone:    lead.phone_1 || '',
      address:  lead.property_address || '',
      category: 'Seller',
      status:   'Active',
      source:   `County Records — ${countyName} (PropStream)`,
      tags,
      notes,
    }])
    .select('id')
    .single()

  if (contact) {
    await supabase
      .from('scraper_leads')
      .update({ status: 'imported', imported_to_contact: contact.id })
      .eq('case_number', lead.case_number)
  }
}
