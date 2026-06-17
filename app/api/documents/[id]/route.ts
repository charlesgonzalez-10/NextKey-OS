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
    .from('documents')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (data.created_by !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const allowed = ['name', 'status', 'offer_amount', 'recipient_name', 'recipient_email', 'sent_at', 'expires_at', 'signing_session_id', 'is_executed', 'executed_at', 'document_type']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await serviceClient
    .from('documents')
    .update(updates)
    .eq('id', id)
    .eq('created_by', user.id)
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

  // Delete associated storage files first
  const { data: doc } = await serviceClient
    .from('documents')
    .select('pdf_path, signed_pdf_path, created_by')
    .eq('id', id)
    .single()

  if (!doc || doc.created_by !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const paths = [doc?.pdf_path, doc?.signed_pdf_path].filter(Boolean) as string[]
  if (paths.length) {
    await serviceClient.storage.from('documents').remove(paths)
  }

  await serviceClient.from('documents').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
