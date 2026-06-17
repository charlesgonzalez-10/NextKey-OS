import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listThreadsWithSummary } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q          = searchParams.get('q') ?? undefined
  const pageToken  = searchParams.get('pageToken') ?? undefined
  const maxResults = parseInt(searchParams.get('maxResults') ?? '20', 10)
  const label      = searchParams.get('label') ?? undefined

  try {
    const result = await listThreadsWithSummary(user.id, {
      q,
      pageToken,
      maxResults,
      labelIds: label ? [label] : undefined,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('Gmail threads error:', err)
    return NextResponse.json({ error: 'Failed to fetch threads' }, { status: 500 })
  }
}
