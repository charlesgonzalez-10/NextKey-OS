/**
 * POST /api/leads/add-to-pipeline
 * Body: { lead_id: string }  (lead_id = properties.id for backward compat)
 *
 * Creates (or reuses) a Contact from a property record and links it to the
 * property as the Primary Owner via RelationshipService. This is "I want to
 * actively reach out to this owner."
 *
 * Flow:
 *  1. Fetch property from properties table
 *  2. Find-or-create the Contact (people CRM) — never duplicates
 *  3. Link Property ↔ Contact as Owner via RelationshipService
 *  4. Update leads.imported_to_contact
 */
import { serviceClient } from '@/lib/supabase-service'
import { RelationshipService } from '@/lib/relationshipService'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const service = serviceClient

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lead_id } = await req.json()
  if (!lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })

  // Fetch property (lead_id = properties.id for backward compat)
  const { data: property, error: fetchErr } = await service
    .from('properties')
    .select('*')
    .eq('id', lead_id)
    .single()

  if (fetchErr || !property) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 })
  }

  // Check if a lead record exists and is already imported (scoped to this user)
  const { data: lead } = await service
    .from('leads')
    .select('id, imported_to_contact')
    .eq('property_id', lead_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (lead?.imported_to_contact) {
    return NextResponse.json({ ok: true, contact_id: lead.imported_to_contact, already: true })
  }

  const countyName =
    property.county === 'miami-dade' ? 'Miami-Dade' :
    property.county === 'broward'    ? 'Broward'     : 'Palm Beach'

  const ownerName = property.owner_name || property.mortgagor || 'Unknown Owner'

  // Build tags from property data
  const tags: string[] = ['pre-foreclosure', property.county]
  if (property.data_source)   tags.push(property.data_source.toLowerCase().replace(/\s+/g, '-'))
  if (property.homestead)     tags.push('owner-occupied')
  if (property.vacant)        tags.push('vacant')
  if (property.multiple_liens) tags.push('multiple-liens')
  if (property.equity_tier)   tags.push(`equity-${property.equity_tier.toLowerCase()}`)
  if (property.entity_type && property.entity_type !== 'Individual') {
    tags.push(property.entity_type.toLowerCase().replace(/\s+/g, '-'))
  }

  // Build notes summary
  const notes = [
    `Pre-Foreclosure — ${countyName} County`,
    property.data_source          ? `Source: ${property.data_source}`                                                  : '',
    property.case_number          ? `Case: ${property.case_number}`                                                    : '',
    property.folio_number         ? `Folio/APN: ${property.folio_number}`                                              : '',
    property.file_date            ? `Filed: ${property.file_date}`                                                     : '',
    property.plaintiff            ? `Plaintiff: ${property.plaintiff}`                                                 : '',
    property.foreclosure_amount   ? `Loan Balance: $${Number(property.foreclosure_amount).toLocaleString()}`           : '',
    property.equity_tier
      ? `Equity: ${property.equity_tier} (${Number(property.equity_percentage ?? 0).toFixed(1)}% / $${Number(property.equity_dollar_amount ?? 0).toLocaleString()})`
      : '',
    property.market_value         ? `Market Value: $${Number(property.market_value).toLocaleString()}`                : '',
    property.beds                 ? `Beds/Baths: ${property.beds}/${property.baths}`                                   : '',
    property.year_built           ? `Year Built: ${property.year_built}`                                               : '',
    property.property_type        ? `Type: ${property.property_type}`                                                  : '',
  ].filter(Boolean).join('\n')

  // Find-or-create the contact (people record) — reuses an existing contact
  // matched by phone/email/name instead of always creating a new one.
  let contactId: string
  try {
    const found = await RelationshipService.findOrCreateContact({
      name:    ownerName,
      phone:   property.phone_1 || null,
      address: property.property_address || null,
      source:  `${property.data_source || 'Property Search'} — ${countyName}`,
    })
    contactId = found.id

    // Metadata specific to this pipeline-add action (tags/notes/category) —
    // only applied when the contact was newly created so we don't overwrite
    // an existing contact's own categorization/notes.
    if (found.created) {
      await service.from('contacts').update({
        city: property.city || '', zip: property.zip || '',
        category: 'Seller', status: 'Active', tags, notes,
      }).eq('id', contactId)
    }

    await RelationshipService.linkPropertyContact(lead_id, contactId, { role: 'Owner', primary: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to create contact' }, { status: 500 })
  }

  // Update the lead record: mark as imported + link to contact
  if (lead) {
    await service
      .from('leads')
      .update({
        imported_to_contact: contactId,
        status:              'reviewing',
        updated_at:          new Date().toISOString(),
      })
      .eq('property_id', lead_id)
      .eq('user_id', user.id)
  } else {
    // Create lead record if it doesn't exist yet
    await service.from('leads').insert([{
      property_id:         lead_id,
      user_id:             user.id,
      status:              'reviewing',
      source:              property.source || 'manual',
      imported_to_contact: contactId,
    }])
  }

  return NextResponse.json({ ok: true, contact_id: contactId })
}
