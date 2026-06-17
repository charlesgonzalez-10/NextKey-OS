import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

interface ThreadInput {
  threadId: string
  subject: string
  from: string
  snippet: string
  date: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })

  const { threads } = await req.json() as { threads: ThreadInput[] }
  if (!threads?.length) return NextResponse.json({ suggestions: [] })

  const capped = threads.slice(0, 25)

  const threadsText = capped.map((t, i) => (
    `${i + 1}. From: ${t.from}\n   Subject: ${t.subject || '(no subject)'}\n   Preview: ${t.snippet?.slice(0, 120) ?? ''}`
  )).join('\n\n')

  const anthropic = new Anthropic({ apiKey })

  const completion = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    system: `You are an email analysis assistant for Charles Gonzalez, a Florida real estate investor and wholesaler at NextKey Property Solutions. Charles buys properties for cash AS-IS, works with sellers, buyers, attorneys, title companies, and investors.`,
    messages: [{
      role: 'user',
      content: `Analyze these ${capped.length} email threads. For each, return a JSON object.

Threads:
${threadsText}

Return ONLY a JSON array (no markdown, no explanation) with one object per thread in the same order:
[
  {
    "thread_index": 1,
    "sender_type": "seller|buyer|attorney|title_company|lender|investor|vendor|other",
    "category": "Hot Lead|Warm Lead|Cold Lead|Contract|Closing|Title|Follow-Up|Legal|Finance|General",
    "tags": ["tag1","tag2"],
    "priority": "high|normal|low",
    "property_address": "address or null",
    "recommended_action": "brief next step for Charles",
    "folder_suggestion": "Sellers|Buyers|Contracts|Closing|Hot Leads|Probate|Pre-Foreclosure|General"
  }
]

Tag rules: 1-3 tags max, lowercase, short. Good tags: seller, buyer, contract, hot-lead, warm-lead, probate, pre-foreclosure, closing, title, attorney, lender, offer, urgent, follow-up, docs-needed.`,
    }],
  })

  const raw = completion.content[0].type === 'text' ? completion.content[0].text.trim() : '[]'

  let parsed: Record<string, unknown>[] = []
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw }, { status: 500 })
  }

  const suggestions = parsed.map((s, i) => ({
    threadId:          capped[i]?.threadId ?? '',
    subject:           capped[i]?.subject ?? '',
    from:              capped[i]?.from ?? '',
    senderType:        s.sender_type ?? 'other',
    category:          s.category ?? 'General',
    tags:              Array.isArray(s.tags) ? s.tags : [],
    priority:          s.priority ?? 'normal',
    propertyAddress:   s.property_address ?? null,
    recommendedAction: s.recommended_action ?? '',
    folderSuggestion:  s.folder_suggestion ?? 'General',
  }))

  return NextResponse.json({ suggestions })
}
