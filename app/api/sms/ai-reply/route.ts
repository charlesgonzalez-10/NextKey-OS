import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { contactId } = await req.json()
  if (!contactId) return NextResponse.json({ error: 'contactId required' }, { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })

  // Fetch contact info
  const { data: contact } = await supabase
    .from('contacts')
    .select('name, category, status, notes')
    .eq('id', contactId)
    .single()

  // Fetch recent message history (last 10)
  const { data: messages } = await supabase
    .from('messages')
    .select('direction, body, created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(10)

  const history = (messages ?? []).reverse()
  const lastInbound = history.findLast(m => m.direction === 'inbound')

  if (!lastInbound) {
    return NextResponse.json({ error: 'No inbound messages to reply to' }, { status: 400 })
  }

  const historyText = history
    .map(m => `${m.direction === 'inbound' ? contact?.name ?? 'Seller' : 'Charles'}: ${m.body}`)
    .join('\n')

  const anthropic = new Anthropic({ apiKey })

  const completion = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 300,
    system: `You are drafting SMS replies for Charles Gonzalez, a licensed Florida real estate investor and wholesaler at NextKey Property Solutions.
Charles is professional, friendly, and direct. He buys properties as-is for cash and helps sellers who need a fast, hassle-free sale.

Guidelines for replies:
- Keep it short (1–3 sentences max — it's a text message)
- Warm but professional tone
- Never make commitments or specific offers — just keep the conversation going
- If seller asks about price, say you need to evaluate the property first
- Sign off naturally, no "Best regards" or formal closings
- Do NOT include Charles's name or signature in the reply
- Write ONLY the reply text, nothing else`,
    messages: [{
      role: 'user',
      content: `Contact: ${contact?.name ?? 'Unknown'} (${contact?.category ?? 'Seller'})
${contact?.notes ? `Notes: ${contact.notes}` : ''}

Conversation:
${historyText}

Draft a reply to their latest message.`,
    }],
  })

  const suggestion = completion.content[0].type === 'text' ? completion.content[0].text.trim() : ''
  return NextResponse.json({ suggestion })
}
