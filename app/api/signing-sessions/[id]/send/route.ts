import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: session } = await serviceClient
    .from('signing_sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const signers = (session.signers as { id: string; name: string; email: string; role?: string; color?: string }[]) ?? []
  if (!signers.length) return NextResponse.json({ error: 'No signers added' }, { status: 400 })

  // Delete old signer rows (resend support)
  await serviceClient.from('session_signers').delete().eq('session_id', id)

  // Create signer rows
  const signerInserts = signers.map((s, idx) => ({
    session_id: id,
    signer_ref_id: s.id,
    name: s.name,
    email: s.email,
    role: s.role ?? null,
    color: s.color ?? '#4CAF9A',
    order_index: idx,
  }))

  const { data: createdRows, error: insertErr } = await serviceClient
    .from('session_signers')
    .insert(signerInserts)
    .select()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Update session status
  await serviceClient
    .from('signing_sessions')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('id', id)

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nextkeyos.vercel.app'

  // Send emails (best-effort)
  const gmailErrors: string[] = []
  try {
    const { sendEmail, getTokenRecord } = await import('@/lib/gmail')
    const gmailToken = await getTokenRecord(user.id)

    const { data: ownerProfile } = await serviceClient
      .from('user_profiles')
      .select('my_name, display_name')
      .eq('id', user.id)
      .single()
    const senderName = (ownerProfile as Record<string, string> | null)?.my_name
      || (ownerProfile as Record<string, string> | null)?.display_name
      || 'Your agent'

    if (gmailToken && createdRows) {
      for (const row of createdRows) {
        const signingUrl = `${baseUrl}/sign/${row.token}`
        const signer = signers.find(s => s.id === row.signer_ref_id)
        const emailBody = `
<p>Hi ${row.name},</p>
<p>${senderName} has requested your signature on <strong>${session.title}</strong>.</p>
${signer?.role ? `<p>Your role: <strong>${signer.role}</strong></p>` : ''}
<p>
  <a href="${signingUrl}" style="display:inline-block;padding:12px 24px;background:#0A1F44;color:#C9A84C;font-weight:bold;border-radius:8px;text-decoration:none;">
    Review &amp; Sign Document
  </a>
</p>
<p style="color:#888;font-size:12px;">This link is unique to you. Do not share it. It expires in 30 days.</p>
<p style="color:#888;font-size:12px;">Powered by NextKey OS</p>
`.trim()

        await sendEmail(user.id, {
          to: row.email,
          subject: `Please sign: ${session.title}`,
          body: emailBody,
        }).catch(e => gmailErrors.push(`${row.email}: ${e.message}`))
      }
    }
  } catch (e: unknown) {
    gmailErrors.push((e as Error).message ?? 'gmail error')
  }

  const result = (createdRows ?? []).map(r => ({
    id: r.id,
    name: r.name,
    email: r.email,
    signing_url: `${baseUrl}/sign/${r.token}`,
  }))

  return NextResponse.json({ ok: true, signers: result, gmail_errors: gmailErrors.length ? gmailErrors : undefined })
}
