/**
 * POST /api/leads/[id]/ai
 * Generates (or regenerates) an AI acquisition analysis for a lead.
 * Body: { force?: boolean }  — force=true to regenerate even if cached
 *
 * Uses Claude Haiku for fast, cheap structured analysis.
 * Result is cached in lead_ai_summaries (upserted).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

const service = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-haiku-4-5'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const force = body.force === true

  // Fetch property (was scraper_leads, now properties — same UUID)
  const { data: lead, error } = await service
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !lead) return NextResponse.json({ error: 'Property not found' }, { status: 404 })

  // Return cached unless forced
  if (!force) {
    const { data: cached } = await service
      .from('lead_ai_summaries')
      .select('*')
      .eq('lead_id', id)
      .maybeSingle()
    if (cached) return NextResponse.json(cached)
  }

  // Compute days since filing
  const daysSince = lead.file_date
    ? Math.floor((Date.now() - new Date(lead.file_date).getTime()) / 86400000)
    : null

  const fmt$ = (v: number | null | undefined) =>
    v != null && !isNaN(Number(v)) ? `$${Number(v).toLocaleString()}` : 'Unknown'

  const prompt = `Analyze this pre-foreclosure lead for an acquisitions team and return a JSON assessment.

PROPERTY
Address: ${lead.property_address || 'Unknown'}, ${lead.city || ''} FL ${lead.zip || ''}
County: ${lead.county || 'Unknown'}
Type: ${lead.property_type || 'Unknown'}  |  Subdivision: ${lead.subdivision_name || 'N/A'}
Beds/Baths: ${lead.beds ?? '?'}/${lead.baths ?? '?'}  |  Sqft: ${lead.living_area ? Number(lead.living_area).toLocaleString() : 'Unknown'}  |  Year Built: ${lead.year_built || 'Unknown'}

OWNERSHIP
Owner: ${lead.owner_name || lead.mortgagor || 'Unknown'}
Entity: ${lead.entity_type || 'Individual'}
Homestead (Owner-Occupied): ${lead.homestead ? 'YES' : 'No'}
Vacant: ${lead.vacant ? 'YES' : 'No'}

FORECLOSURE
Filed: ${lead.file_date || 'Unknown'}${daysSince !== null ? ` — ${daysSince} DAYS AGO` : ''}
Type: ${lead.foreclosure_type === 'P' ? 'Pre-Foreclosure / Lis Pendens' : lead.foreclosure_type || 'Unknown'}
Plaintiff/Bank: ${lead.plaintiff || lead.lender_name || 'Unknown'}
Loan Balance (FC Amount): ${fmt$(lead.foreclosure_amount)}
Multiple Liens: ${lead.multiple_liens ? 'YES — higher risk/complexity' : 'No'}
Case #: ${lead.case_number || 'N/A'}

VALUATION
Assessed Value: ${fmt$(lead.assessed_value)}
Market Value: ${fmt$(lead.market_value)}
Equity Tier: ${lead.equity_tier || 'Unknown'}
Estimated Equity: ${lead.equity_percentage != null ? Number(lead.equity_percentage).toFixed(1) + '%' : '?'} / ${fmt$(lead.equity_dollar_amount)}

Return ONLY valid JSON with exactly this structure (no markdown fences):
{
  "distress_score": <integer 1-10, 10=most distressed>,
  "motivation": <"low"|"medium"|"high"|"very-high">,
  "strategy": <"cash"|"creative-finance"|"list"|"skip">,
  "urgency": <"low"|"medium"|"high">,
  "lead_quality": <integer 1-10, 10=best opportunity>,
  "summary": "<2-3 sentence operational assessment for acquisitions team>",
  "highlights": ["<key insight 1>", "<key insight 2>", "<key insight 3>"]
}`

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: 'You are an expert real estate acquisitions analyst. Evaluate distressed property leads. Return only valid JSON with no markdown.',
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (message.content[0] as { type: string; text: string }).text.trim()
    const analysis = JSON.parse(raw)

    // Validate required fields
    const required = ['distress_score', 'motivation', 'strategy', 'urgency', 'lead_quality', 'summary', 'highlights']
    for (const key of required) {
      if (!(key in analysis)) throw new Error(`Missing field: ${key}`)
    }

    const { data: saved, error: upsertErr } = await service
      .from('lead_ai_summaries')
      .upsert(
        { lead_id: id, model: MODEL, ...analysis },
        { onConflict: 'lead_id' }
      )
      .select()
      .single()

    if (upsertErr) {
      console.error('AI summary upsert error:', upsertErr)
      return NextResponse.json({ lead_id: id, model: MODEL, ...analysis })
    }

    return NextResponse.json(saved)
  } catch (err) {
    console.error('AI analysis error:', err)
    return NextResponse.json({ error: 'AI analysis failed. Check server logs.' }, { status: 500 })
  }
}
