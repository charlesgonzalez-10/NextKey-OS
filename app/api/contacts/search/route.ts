import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

// GET /api/contacts/search?q=NAME_OR_PHONE&limit=10
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url   = new URL(req.url)
  const q     = url.searchParams.get('q')?.trim() ?? ''
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50)

  const category = url.searchParams.get('category')?.trim()

  // Category-only lookup (for Business Folders — returns email list)
  if (category && !q) {
    const { data, error } = await serviceClient
      .from('contacts')
      .select('id, name, phone, email, category')
      .ilike('category', `%${category}%`)
      .not('email', 'is', null)
      .limit(100)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ contacts: data ?? [] })
  }

  if (!q) return NextResponse.json({ contacts: [] })

  const { data, error } = await serviceClient
    .from('contacts')
    .select('id, name, phone, email, address, category')
    .or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contacts: data ?? [] })
}
