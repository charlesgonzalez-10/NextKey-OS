import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data, error } = await serviceClient
    .from('email_templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PUT(req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name        !== undefined) fields.name        = body.name
  if (body.category    !== undefined) fields.category    = body.category
  if (body.folder      !== undefined) fields.folder      = body.folder
  if (body.description !== undefined) fields.description = body.description
  if (body.subject     !== undefined) fields.subject     = body.subject
  if (body.body        !== undefined) fields.body        = body.body

  const { data, error } = await serviceClient
    .from('email_templates')
    .update(fields)
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

  // Prevent deleting built-in templates
  const { data: tmpl } = await serviceClient
    .from('email_templates')
    .select('is_builtin')
    .eq('id', id)
    .single()

  if (tmpl?.is_builtin) {
    return NextResponse.json({ error: 'Cannot delete built-in template' }, { status: 400 })
  }

  const { error } = await serviceClient
    .from('email_templates')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
