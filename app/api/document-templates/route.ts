import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { extractVariables } from '@/lib/documents/template-utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await serviceClient
    .from('document_templates')
    .select('id, name, category, description, variables, is_active, is_builtin, created_at')
    .eq('is_active', true)
    .order('is_builtin', { ascending: false })
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, category, description, content } = body

  if (!name || !content) {
    return NextResponse.json({ error: 'name and content are required' }, { status: 400 })
  }

  const variables = extractVariables(content)

  const { data, error } = await serviceClient
    .from('document_templates')
    .insert({ name, category: category ?? 'other', description, content, variables, created_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
