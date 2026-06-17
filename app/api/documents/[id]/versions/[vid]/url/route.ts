import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string; vid: string }> }

export async function GET(_req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, vid } = await params
  const { data: version } = await serviceClient
    .from('document_versions')
    .select('file_path')
    .eq('id', vid)
    .eq('document_id', id)
    .single()

  if (!version?.file_path) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: urlData, error } = await serviceClient.storage
    .from('documents')
    .createSignedUrl(version.file_path, 3600)

  if (error || !urlData) return NextResponse.json({ error: 'Could not generate URL' }, { status: 500 })
  return NextResponse.json({ url: urlData.signedUrl })
}
