import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const page    = parseInt(searchParams.get('page')  || '1', 10)
  const limit   = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500)
  const county  = searchParams.get('county') || ''
  const search  = searchParams.get('search') || ''
  const equity  = searchParams.get('equity') || ''
  const status  = searchParams.get('status') || ''

  let query = supabase
    .from('scraper_leads')
    .select(`
      id, created_at, county, status, skip_reason,
      case_number, file_date, plaintiff, mortgagor, foreclosure_amount,
      lender_name, foreclosure_type, multiple_liens,
      folio_number, owner_name, property_address, city, zip,
      beds, baths, year_built, living_area, lot_size,
      assessed_value, market_value, equity_percentage,
      equity_dollar_amount, equity_tier, known_debt,
      homestead, vacant, entity_type,
      phone_1, phone_2, phone_3, phone_4, phone_5,
      subdivision_name, property_type,
      imported_to_contact
    `, { count: 'exact' })
    .order('file_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (county) query = query.eq('county', county)
  if (equity) query = query.eq('equity_tier', equity)
  if (status) query = query.eq('status', status)
  if (search) {
    query = query.or(
      `owner_name.ilike.%${search}%,property_address.ilike.%${search}%,case_number.ilike.%${search}%,folio_number.ilike.%${search}%`
    )
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    leads: data || [],
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit),
  })
}
