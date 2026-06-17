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

  const [{ data: session }, { data: signerRows }] = await Promise.all([
    serviceClient.from('signing_sessions').select('*').eq('id', id).eq('user_id', user.id).single(),
    serviceClient.from('session_signers').select('*').eq('session_id', id).order('order_index'),
  ])

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: urlData } = await serviceClient.storage
    .from('documents')
    .createSignedUrl(session.pdf_path, 3600)

  return NextResponse.json({ ...session, pdf_url: urlData?.signedUrl ?? null, signer_rows: signerRows ?? [] })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const allowed = ['title', 'fields', 'signers', 'status', 'pdf_path']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of allowed) { if (k in body) updates[k] = body[k] }

  const { data, error } = await serviceClient
    .from('signing_sessions')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
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

  await serviceClient.from('session_signers').delete().eq('session_id', id)
  const { error } = await serviceClient
    .from('signing_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
