import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getThreadMessages } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const messages = await getThreadMessages(user.id, id)
    return NextResponse.json({ messages })
  } catch (err) {
    console.error('Gmail thread detail error:', err)
    return NextResponse.json({ error: 'Failed to fetch thread' }, { status: 500 })
  }
}
