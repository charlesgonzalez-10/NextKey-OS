import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { extractVariables } from '@/lib/documents/template-utils'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data, error } = await serviceClient
    .from('document_templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PUT(req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.name)        updates.name        = body.name
  if (body.category)    updates.category    = body.category
  if (body.description !== undefined) updates.description = body.description
  if (body.content) {
    updates.content   = body.content
    updates.variables = extractVariables(body.content)
  }
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active

  const { data, error } = await serviceClient
    .from('document_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Soft-delete built-in templates; hard-delete custom ones
  const { data: tmpl } = await serviceClient
    .from('document_templates')
    .select('is_builtin')
    .eq('id', id)
    .single()

  if (tmpl?.is_builtin) {
    await serviceClient.from('document_templates').update({ is_active: false }).eq('id', id)
  } else {
    await serviceClient.from('document_templates').delete().eq('id', id)
  }

  return NextResponse.json({ ok: true })
}
