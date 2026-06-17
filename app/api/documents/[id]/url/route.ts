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
  const { data: doc } = await serviceClient
    .from('documents')
    .select('pdf_path, signed_pdf_path, file_path, file_type, name')
    .eq('id', id)
    .single()

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const path = (doc as Record<string, unknown>).signed_pdf_path as string | null
            || (doc as Record<string, unknown>).pdf_path as string | null
            || (doc as Record<string, unknown>).file_path as string | null
  if (!path) return NextResponse.json({ error: 'No file available' }, { status: 404 })

  // 60-minute signed URL
  const { data: urlData, error } = await serviceClient.storage
    .from('documents')
    .createSignedUrl(path, 3600)

  if (error || !urlData) {
    return NextResponse.json({ error: 'Could not generate URL' }, { status: 500 })
  }

  return NextResponse.json({ url: urlData.signedUrl, name: doc.name, pdf_path: path })
}
