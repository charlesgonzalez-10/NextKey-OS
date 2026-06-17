/**
 * POST /api/leads/[id]/comms/ai-email
 *
 * Generate an AI-drafted email reply or outreach for a lead.
 * Body: { tone, context, thread_snippet?, contact_name?, property_address? }
 * Tones: 'professional' | 'friendly' | 'negotiation' | 'follow_up' | 'reminder' | 'counter'
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

const TONE_PROMPTS: Record<string, string> = {
  professional: 'Write in a formal, professional tone. Be clear and concise.',
  friendly:     'Write in a warm, friendly tone. Be personable and approachable.',
  negotiation:  'Write in a diplomatic, negotiation-focused tone. Be flexible but firm on value.',
  follow_up:    'Write a gentle follow-up. Reference the previous conversation and express continued interest.',
  reminder:     'Write a polite reminder about a pending item. Keep it brief and actionable.',
  counter:      'Write a counter-offer response. Be professional, acknowledge their position, and clearly state the counter.',
  custom:       'Write the email based on the provided context.',
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await params
  const body = await req.json()
  const {
    tone = 'professional',
    context = '',
    thread_snippet = '',
    contact_name = 'Seller',
    property_address = '',
    subject = '',
  } = body

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })

  const toneInstruction = TONE_PROMPTS[tone] ?? TONE_PROMPTS.professional
  const anthropic = new Anthropic({ apiKey })

  const prompt = [
    `You are drafting an email for Charles Gonzalez, a licensed Florida real estate investor and wholesaler at NextKey Property Solutions.`,
    `Charles buys properties for cash, closes quickly, and purchases as-is.`,
    ``,
    `${toneInstruction}`,
    ``,
    `Contact name: ${contact_name}`,
    property_address ? `Property: ${property_address}` : '',
    subject ? `Email subject context: ${subject}` : '',
    thread_snippet ? `\nPrevious email thread:\n${thread_snippet}` : '',
    context ? `\nAdditional context: ${context}` : '',
    ``,
    `Write ONLY the email body (HTML format with <p> tags). Include a greeting and sign-off.`,
    `Sign off as: Charles Gonzalez | NextKey Property Solutions`,
    `Do not include Subject: line, just the body.`,
  ].filter(Boolean).join('\n')

  const completion = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const draft = completion.content[0].type === 'text' ? completion.content[0].text.trim() : ''

  // Generate a subject line too
  const subjectCompletion = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 60,
    messages: [{
      role: 'user',
      content: `Write ONLY a subject line (no quotes, no prefix) for this real estate email:\n${draft.slice(0, 200)}\nProperty: ${property_address}\nContact: ${contact_name}`,
    }],
  })

  const suggestedSubject = subjectCompletion.content[0].type === 'text'
    ? subjectCompletion.content[0].text.trim()
    : ''

  return NextResponse.json({ draft, subject: suggestedSubject })
}
