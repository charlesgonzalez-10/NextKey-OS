import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completeSigningSession } from '@/lib/documents/signingCompleter'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

// POST — agent-triggered manual completion (or recovery after auto-completion
// failed). Calls the same canonical completeSigningSession() that auto-complete
// uses, so there is exactly one completion code path and it is idempotent.

export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const result = await completeSigningSession(id, user.id)
    return NextResponse.json({
      ok: true,
      already_complete:    result.alreadyComplete,
      completed_pdf_url:   result.completedPdfUrl,
      certificate_url:     result.certificateUrl,
    })
  } catch (err: unknown) {
    const msg = (err as Error).message ?? 'Completion failed'
    const status = msg.includes('not found') ? 404
                 : msg.includes('not all signers') ? 400
                 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
