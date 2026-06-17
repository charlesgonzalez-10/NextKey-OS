import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const filename = req.nextUrl.searchParams.get('filename') ?? 'contract.pdf'
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `contract-templates/${user.id}/${Date.now()}_${safe}`

  const { data, error } = await serviceClient.storage
    .from('documents')
    .createSignedUploadUrl(path)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ signedUrl: data.signedUrl, path })
}
