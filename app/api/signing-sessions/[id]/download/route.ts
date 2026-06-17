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

  const { data: session } = await serviceClient
    .from('signing_sessions')
    .select('completed_pdf_path, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.status !== 'completed' || !session.completed_pdf_path) {
    return NextResponse.json({ error: 'No signed PDF available yet' }, { status: 404 })
  }

  const { data: urlData } = await serviceClient.storage
    .from('documents')
    .createSignedUrl(session.completed_pdf_path, 300)

  if (!urlData?.signedUrl) return NextResponse.json({ error: 'Could not generate download link' }, { status: 500 })

  return NextResponse.json({ url: urlData.signedUrl })
}
