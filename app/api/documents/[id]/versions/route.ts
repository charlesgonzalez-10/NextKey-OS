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
    .from('document_versions')
    .select('*')
    .eq('document_id', id)
    .order('version', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ versions: data ?? [] })
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { notes } = await req.json().catch(() => ({}))

  // Fetch current doc to snapshot its paths
  const { data: doc } = await serviceClient
    .from('documents')
    .select('signed_pdf_path, pdf_path, file_path')
    .eq('id', id)
    .single()

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Get current max version
  const { data: latest } = await serviceClient
    .from('document_versions')
    .select('version')
    .eq('document_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  const nextVersion = (latest?.version ?? 0) + 1
  const filePath = doc.signed_pdf_path || doc.pdf_path || doc.file_path

  const { data, error } = await serviceClient
    .from('document_versions')
    .insert({ document_id: id, version: nextVersion, file_path: filePath, notes: notes || null, created_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log activity
  await serviceClient.from('document_activity').insert({
    document_id: id, action: 'version_saved',
    notes: `Version ${nextVersion} saved`, created_by: user.id,
  })

  return NextResponse.json({ version: data }, { status: 201 })
}
