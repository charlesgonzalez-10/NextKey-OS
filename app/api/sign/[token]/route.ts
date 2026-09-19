import { NextRequest, NextResponse } from 'next/server'
import { serviceClient } from '@/lib/supabase-service'
import { completeSigningSession } from '@/lib/documents/signingCompleter'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ token: string }> }

// ── GET — public: load signer's view ─────────────────────────────────────────
// No auth required. serviceClient (service role) is used server-side to look
// up the signer row by exact token match. The anon DB policy has been removed;
// this server route is the only permitted access path.

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params

  const { data: signerRow } = await serviceClient
    .from('session_signers')
    .select('id, session_id, signer_ref_id, name, email, role, color, status, expires_at')
    .eq('token', token)
    .single()

  if (!signerRow) return NextResponse.json({ error: 'Invalid or expired signing link.' }, { status: 404 })

  // Enforce signing-link expiry
  if (signerRow.expires_at && new Date(signerRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This signing link has expired.', errorStatus: 'expired' }, { status: 410 })
  }

  if (signerRow.status === 'signed')   return NextResponse.json({ error: 'You have already signed this document.', errorStatus: 'signed' }, { status: 410 })
  if (signerRow.status === 'declined') return NextResponse.json({ error: 'This signing request was declined.', errorStatus: 'declined' }, { status: 410 })

  const { data: session } = await serviceClient
    .from('signing_sessions')
    .select('id, title, pdf_path, fields, signers, status')
    .eq('id', signerRow.session_id)
    .single()

  if (!session) return NextResponse.json({ error: 'Signing session not found.' }, { status: 404 })
  if (session.status === 'voided') return NextResponse.json({ error: 'This signing session has been voided.', errorStatus: 'voided' }, { status: 410 })

  const { data: urlData } = await serviceClient.storage
    .from('documents')
    .createSignedUrl(session.pdf_path as string, 3600)

  if (signerRow.status === 'pending') {
    await serviceClient.from('session_signers').update({
      status: 'viewed', viewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('token', token)
  }

  const allFields = (session.fields as { signer_id: string }[]) ?? []
  const myFields = allFields.filter(f => f.signer_id === signerRow.signer_ref_id)

  return NextResponse.json({
    flow: 'session',
    session_id:    session.id,
    title:         session.title,
    signer_name:   signerRow.name,
    signer_email:  signerRow.email,
    signer_role:   signerRow.role,
    signer_color:  signerRow.color,
    signer_ref_id: signerRow.signer_ref_id,
    pdf_url:       urlData?.signedUrl ?? null,
    fields:        myFields,
  })
}

// ── POST — public: submit signed fields / decline ─────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params
  const body = await req.json()
  const { action, fields_data, decline_reason } = body

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown'
  const ua = req.headers.get('user-agent') ?? ''

  const { data: signerRow } = await serviceClient
    .from('session_signers')
    .select('id, session_id, signer_ref_id, name, email, status, expires_at')
    .eq('token', token)
    .single()

  if (!signerRow) return NextResponse.json({ error: 'Invalid signing link.' }, { status: 404 })

  // Enforce expiry on submission too
  if (signerRow.expires_at && new Date(signerRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This signing link has expired.', errorStatus: 'expired' }, { status: 410 })
  }

  if (signerRow.status === 'signed')   return NextResponse.json({ error: 'Already signed.' }, { status: 410 })
  if (signerRow.status === 'declined') return NextResponse.json({ error: 'Already declined.' }, { status: 410 })

  if (action === 'decline') {
    await serviceClient.from('session_signers').update({
      status: 'declined', declined_at: new Date().toISOString(),
      decline_reason: decline_reason ?? null, signer_ip: ip, signer_ua: ua,
      updated_at: new Date().toISOString(),
    }).eq('token', token)
    await serviceClient.from('signing_sessions').update({
      status: 'voided', updated_at: new Date().toISOString(),
    }).eq('id', signerRow.session_id)
    return NextResponse.json({ ok: true, status: 'declined' })
  }

  // Mark this signer as signed
  await serviceClient.from('session_signers').update({
    status: 'signed', signed_at: new Date().toISOString(),
    signer_ip: ip, signer_ua: ua, fields_data: fields_data ?? {},
    updated_at: new Date().toISOString(),
  }).eq('token', token)

  // Check if all signers are now done
  const { data: allRows } = await serviceClient
    .from('session_signers')
    .select('status')
    .eq('session_id', signerRow.session_id)

  const allSigned = (allRows ?? []).every(r => r.status === 'signed')

  if (allSigned) {
    // Trigger canonical completion (fire-and-forget — do not block the signer response)
    completeSigningSession(signerRow.session_id).catch(() => {})
  }

  return NextResponse.json({ ok: true, status: 'signed', all_signed: allSigned })
}
