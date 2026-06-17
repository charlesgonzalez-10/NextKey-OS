/**
 * POST /api/leads/bulk-add-to-pipeline
 * Body: { lead_ids: string[] }  (lead_ids = properties.id values)
 *
 * Bulk-creates Contacts from property records and links them to leads.
 * Skips any already imported. Returns counts.
 */
import { serviceClient } from '@/lib/supabase-service'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60

const service = serviceClient

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lead_ids } = await req.json() as { lead_ids: string[] }
  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    return NextResponse.json({ error: 'lead_ids required' }, { status: 400 })
  }

  // Fetch all requested properties in one query
  const { data: properties, error: fetchErr } = await service
    .from('properties')
    .select('*')
    .in('id', lead_ids)

  if (fetchErr || !properties) {
    return NextResponse.json({ error: fetchErr?.message || 'Failed to fetch properties' }, { status: 500 })
  }

  // Fetch existing lead records to check imported status
  const { data: existingLeads } = await service
    .from('leads')
    .select('property_id, imported_to_contact')
    .in('property_id', lead_ids)

  const importedMap = new Map(
    (existingLeads ?? []).map(l => [l.property_id as string, l.imported_to_contact as string | null])
  )

  let created  = 0
  let skipped  = 0
  const createdPropIds: string[] = []

  for (const property of properties) {
    // Skip already-imported
    if (importedMap.get(property.id)) { skipped++; continue }

    const countyName =
      property.county === 'miami-dade' ? 'Miami-Dade' :
      property.county === 'broward'    ? 'Broward'     : 'Palm Beach'

    const ownerName = property.owner_name || property.mortgagor || 'Unknown Owner'

    const tags: string[] = ['pre-foreclosure', property.county]
    if (property.data_source)   tags.push(property.data_source.toLowerCase().replace(/\s+/g, '-'))
    if (property.homestead)     tags.push('owner-occupied')
    if (property.vacant)        tags.push('vacant')
    if (property.multiple_liens) tags.push('multiple-liens')
    if (property.equity_tier)   tags.push(`equity-${property.equity_tier.toLowerCase()}`)
    if (property.entity_type && property.entity_type !== 'Individual') {
      tags.push(property.entity_type.toLowerCase().replace(/\s+/g, '-'))
    }

    const notes = [
      `Pre-Foreclosure — ${countyName} County`,
      property.data_source        ? `Source: ${property.data_source}` : '',
      property.case_number        ? `Case: ${property.case_number}` : '',
      property.folio_number       ? `Folio/APN: ${property.folio_number}` : '',
      property.file_date          ? `Filed: ${property.file_date}` : '',
      property.plaintiff          ? `Plaintiff: ${property.plaintiff}` : '',
      property.foreclosure_amount ? `Loan Balance: $${Number(property.foreclosure_amount).toLocaleString()}` : '',
      property.equity_tier
        ? `Equity: ${property.equity_tier} (${Number(property.equity_percentage ?? 0).toFixed(1)}% / $${Number(property.equity_dollar_amount ?? 0).toLocaleString()})`
        : '',
      property.market_value  ? `Market Value: $${Number(property.market_value).toLocaleString()}` : '',
      property.beds          ? `Beds/Baths: ${property.beds}/${property.baths}` : '',
      property.year_built    ? `Year Built: ${property.year_built}` : '',
      property.property_type ? `Type: ${property.property_type}` : '',
    ].filter(Boolean).join('\n')

    const { data: contact, error: cErr } = await service
      .from('contacts')
      .insert([{
        name:        ownerName,
        phone:       property.phone_1 || '',
        address:     property.property_address || '',
        city:        property.city || '',
        zip:         property.zip  || '',
        category:    'Seller',
        status:      'Active',
        source:      `${property.data_source || 'Property Search'} — ${countyName}`,
        property_id: property.id,
        tags,
        notes,
      }])
      .select('id')
      .single()

    if (cErr || !contact) continue

    createdPropIds.push(property.id)
    created++
  }

  // Bulk-update leads as imported
  if (createdPropIds.length > 0) {
    await service
      .from('leads')
      .upsert(
        createdPropIds.map(pid => ({
          property_id:         pid,
          status:              'reviewing',
          source:              'manual',
          updated_at:          new Date().toISOString(),
        })),
        { onConflict: 'property_id', ignoreDuplicates: false }
      )
  }

  return NextResponse.json({ ok: true, created, skipped, total: lead_ids.length })
}
