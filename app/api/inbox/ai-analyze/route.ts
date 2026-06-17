import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })

  const { subject, body, senderName, senderEmail } = await req.json()
  if (!subject && !body) return NextResponse.json({ error: 'subject or body required' }, { status: 400 })

  const stripped = (body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000)

  const anthropic = new Anthropic({ apiKey })
  const completion = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 900,
    system: `You are a real estate investment analyst for Charles Gonzalez, a Florida cash buyer and wholesaler at NextKey Property Solutions. Analyze emails from potential sellers and buyers concisely.`,
    messages: [{
      role: 'user',
      content: `Analyze this email and respond with ONLY valid JSON — no markdown, no explanation.

From: ${senderName ?? 'Unknown'} <${senderEmail ?? ''}>
Subject: ${subject ?? ''}
Body: ${stripped}

Return exactly this JSON structure:
{
  "summary": "2-3 sentence summary of what this email is about and what the sender wants",
  "motivation": "Hot",
  "motivation_reason": "one sentence explaining the motivation level",
  "timeline": "their timeline or Not mentioned",
  "asking_price": "price if mentioned or Not mentioned",
  "property_address": "street address if clearly mentioned in the email, or null",
  "recommended_action": "specific next step Charles should take",
  "suggested_reply": "draft reply 2-4 sentences, warm and professional, written as Charles"
}

motivation must be exactly one of: Hot, Warm, Cold`,
    }],
  })

  const raw = completion.content[0].type === 'text' ? completion.content[0].text.trim() : '{}'
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })

  try {
    const result = JSON.parse(jsonMatch[0])
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
