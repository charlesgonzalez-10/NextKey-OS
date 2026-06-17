import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTokenRecord } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ connected: false }, { status: 401 })

  const token = await getTokenRecord(user.id)
  if (!token) return NextResponse.json({ connected: false })

  return NextResponse.json({
    connected: true,
    email: token.email,
    scope: token.scope,
    expires_at: token.expires_at,
  })
}
