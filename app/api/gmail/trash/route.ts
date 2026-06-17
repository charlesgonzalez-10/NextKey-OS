import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGmailClient } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { threadId } = await req.json()
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 })

  const gmail = await getGmailClient(user.id)
  if (!gmail) return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })

  try {
    await gmail.users.threads.trash({ userId: 'me', id: threadId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to trash'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
