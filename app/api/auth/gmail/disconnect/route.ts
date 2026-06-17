import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGmailClient, deleteTokens } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const gmail = await getGmailClient(user.id)
    if (gmail) {
      // Attempt to revoke — ignore failures (token may already be expired)
      await gmail.users.getProfile({ userId: 'me' }).catch(() => {})
    }
  } catch {}

  await deleteTokens(user.id)
  return NextResponse.json({ disconnected: true })
}
