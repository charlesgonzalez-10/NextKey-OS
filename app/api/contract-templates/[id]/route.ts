import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data, error } = await serviceClient
    .from('contract_templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (data.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Return with a signed URL for viewing
  const { data: urlData } = await serviceClient.storage
    .from('documents')
    .createSignedUrl(data.file_path, 3600)

  return NextResponse.json({ ...data, url: urlData?.signedUrl ?? null })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: existing } = await serviceClient
    .from('contract_templates')
    .select('user_id')
    .eq('id', id)
    .single()

  if (!existing || existing.user_id !== user.id)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string') updates.name = body.name.trim()
  if (typeof body.category === 'string') updates.category = body.category
  if (typeof body.description === 'string') updates.description = body.description
  const { data, error } = await serviceClient
    .from('contract_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: tmpl } = await serviceClient
    .from('contract_templates')
    .select('file_path, user_id')
    .eq('id', id)
    .single()

  if (!tmpl || tmpl.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (tmpl.file_path) {
    await serviceClient.storage.from('documents').remove([tmpl.file_path])
  }

  const { error } = await serviceClient
    .from('contract_templates')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
