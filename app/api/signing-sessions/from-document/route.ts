import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

// POST /api/signing-sessions/from-document
//
// Creates a signing session from a generated document and sends it to signers.
// Writes to signing_sessions + session_signers (the canonical signing tables).
// signing_role_assignments is preserved for future DBE use but not written here.
//
// Body:
//   document_id       required
//   role_assignments  required — [{ signer_role_id, name, email, phone?, contact_id?, signing_order }]

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { document_id, role_assignments } = body as {
    document_id:      string
    role_assignments: {
      signer_role_id: string
      name:           string
      email:          string
      phone?:         string | null
      contact_id?:    string | null
      signing_order:  number
    }[]
  }

  if (!document_id)
    return NextResponse.json({ error: 'document_id required' }, { status: 400 })
  if (!Array.isArray(role_assignments) || role_assignments.length === 0)
    return NextResponse.json({ error: 'role_assignments must be a non-empty array' }, { status: 400 })

  // Load document (fields_snapshot carries blueprint field positions + signer roles)
  const { data: doc } = await serviceClient
    .from('documents')
    .select('id, name, pdf_path, signed_pdf_path, file_path, blueprint_version_id, property_id, lead_id, contact_id, deal_id, created_by, fields_snapshot')
    .eq('id', document_id)
    .single()

  if (!doc || doc.created_by !== user.id)
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const pdfPath = doc.pdf_path || doc.signed_pdf_path || doc.file_path
  if (!pdfPath) return NextResponse.json({ error: 'Document has no PDF' }, { status: 400 })

  // Resolve role names for display
  const roleIds = role_assignments.map(a => a.signer_role_id)
  const { data: roles } = await serviceClient
    .from('signer_roles')
    .select('id, name')
    .in('id', roleIds)
  const roleMap = Object.fromEntries((roles ?? []).map(r => [r.id, r.name]))

  // Build signers JSONB (for signing_sessions.signers)
  const signersJson = role_assignments.map((a, idx) => ({
    id:    `signer_${idx}`,
    name:  a.name,
    email: a.email,
    role:  roleMap[a.signer_role_id] ?? null,
    color: '#4CAF9A',
  }))

  // Map signer_role_id → signer_ref_id so blueprint fields can reference the right signer
  const roleIdToSignerRef: Record<string, string> = {}
  role_assignments.forEach((a, idx) => { roleIdToSignerRef[a.signer_role_id] = `signer_${idx}` })

  // Hydrate blueprint signing-field positions from the document's fields_snapshot.
  // Only signature/initial/date fields go into the session; merge_text fields were
  // pre-filled by the merge engine and are already burned into the PDF.
  type SnapshotEntry = Record<string, unknown>
  const SIGNING_TYPES = new Set(['signature', 'initial', 'initials', 'date'])
  const snapshot = Array.isArray(doc.fields_snapshot) ? (doc.fields_snapshot as SnapshotEntry[]) : []
  const hydratedFields = snapshot
    .filter(f => SIGNING_TYPES.has(String(f.fieldType ?? '')))
    .map((f, i) => {
      const roleId    = String(f.signerRoleId ?? f.signer_role_id ?? '')
      const fieldType = String(f.fieldType)
      return {
        id:        `blueprint_field_${i}`,
        type:      fieldType === 'initial' ? 'initials' : fieldType,
        page:      Number(f.page ?? 1),
        x:         Number(f.x ?? 0),
        y:         Number(f.y ?? 0),
        w:         Number(f.w ?? f.width ?? 0.22),
        h:         Number(f.h ?? f.height ?? 0.055),
        signer_id: roleId ? (roleIdToSignerRef[roleId] ?? '') : '',
        required:  Boolean(f.required ?? true),
        label:     f.label ? String(f.label) : fieldType,
      }
    })

  // Create signing session
  const { data: session, error: sErr } = await serviceClient
    .from('signing_sessions')
    .insert({
      user_id:              user.id,
      title:                doc.name,
      pdf_path:             pdfPath,
      status:               'draft',
      fields:               hydratedFields,
      signers:              signersJson,
      property_id:          doc.property_id ?? null,
      lead_id:              doc.lead_id     ?? null,
      contact_id:           doc.contact_id  ?? null,
      deal_id:              doc.deal_id     ?? null,
      blueprint_version_id: doc.blueprint_version_id ?? null,
      document_id:          doc.id,
    })
    .select('id')
    .single()

  if (sErr || !session) return NextResponse.json({ error: sErr?.message ?? 'Failed to create session' }, { status: 500 })

  const sessionId = session.id as string

  // Create session_signers rows (canonical table — same path as /send route)
  const signerInserts = signersJson.map((s, idx) => ({
    session_id:    sessionId,
    signer_ref_id: s.id,
    name:          s.name,
    email:         s.email,
    role:          s.role ?? null,
    color:         s.color,
    order_index:   idx,
  }))

  const { data: createdRows, error: insertErr } = await serviceClient
    .from('session_signers')
    .insert(signerInserts)
    .select()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Mark session sent
  await serviceClient
    .from('signing_sessions')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  // Link document → session
  await serviceClient
    .from('documents')
    .update({
      status:             'pending_signature',
      signing_session_id: sessionId,
      updated_at:         new Date().toISOString(),
    })
    .eq('id', document_id)

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nextkeyos.vercel.app'

  // Send Gmail invitations (best-effort)
  const gmailErrors: string[] = []
  try {
    const { sendEmail, getTokenRecord } = await import('@/lib/gmail')
    const gmailToken = await getTokenRecord(user.id)
    const { data: ownerProfile } = await serviceClient.from('user_profiles').select('my_name, display_name').eq('id', user.id).single()
    const senderName = (ownerProfile as Record<string, string> | null)?.my_name
      || (ownerProfile as Record<string, string> | null)?.display_name
      || 'Your agent'

    if (gmailToken && createdRows) {
      for (const row of createdRows) {
        const signingUrl = `${baseUrl}/sign/${row.token}`
        const signer = signersJson.find(s => s.id === row.signer_ref_id)
        const emailBody = `
<p>Hi ${row.name},</p>
<p>${senderName} has requested your signature on <strong>${doc.name}</strong>.</p>
${signer?.role ? `<p>Your role: <strong>${signer.role}</strong></p>` : ''}
<p>
  <a href="${signingUrl}" style="display:inline-block;padding:12px 24px;background:#0A1F44;color:#C9A84C;font-weight:bold;border-radius:8px;text-decoration:none;">
    Review &amp; Sign Document
  </a>
</p>
<p style="color:#888;font-size:12px;">This link is unique to you. Do not share it. It expires in 30 days.</p>
<p style="color:#888;font-size:12px;">Powered by NextKey OS</p>
`.trim()
        await sendEmail(user.id, { to: row.email, subject: `Please sign: ${doc.name}`, body: emailBody })
          .catch(e => gmailErrors.push(`${row.email}: ${(e as Error).message}`))
      }
    }
  } catch (e: unknown) {
    gmailErrors.push((e as Error).message ?? 'gmail error')
  }

  const sentSigners = (createdRows ?? []).map(r => ({
    id:         r.id,
    name:       r.name,
    email:      r.email,
    signing_url: `${baseUrl}/sign/${r.token}`,
  }))

  return NextResponse.json({
    session_id:   sessionId,
    signers:      sentSigners,
    gmail_errors: gmailErrors.length ? gmailErrors : undefined,
  }, { status: 201 })
}
