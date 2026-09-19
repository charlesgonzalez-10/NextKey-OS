/**
 * SigningService — single-responsibility: assign people to roles, track
 * progress, store signatures.
 *
 * This is the DBE-aware replacement path. The legacy signing_sessions POST +
 * session_signers flow is still alive for manually-created sessions without a
 * blueprint. This service handles sessions that originate from a generated
 * document with a blueprint_version_id.
 */
import { serviceClient } from '@/lib/supabase-service'

export interface RoleAssignmentInput {
  signerRoleId:  string
  name:          string
  email:         string
  phone?:        string | null
  contactId?:    string | null
  signingOrder:  number
}

export interface SentSigner {
  id:          string
  name:        string
  email:       string
  role_name:   string
  signing_url: string
}

export interface SessionWithRoles {
  id:                  string
  title:               string
  status:              string
  pdf_path:            string
  document_id:         string | null
  blueprint_version_id:string | null
  property_id:         string | null
  created_at:          string
  role_assignments: {
    id:            string
    signer_role_id:string
    role_name:     string
    color:         string
    name:          string
    email:         string
    phone:         string | null
    signing_order: number
    status:        string
    token:         string
    signed_at:     string | null
    viewed_at:     string | null
  }[]
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createSigningSession(opts: {
  userId:              string
  title:               string
  pdfPath:             string
  documentId?:         string | null
  propertyId?:         string | null
  leadId?:             string | null
  contactId?:          string | null
  dealId?:             string | null
  blueprintVersionId?: string | null
}): Promise<string> {
  const { data, error } = await serviceClient
    .from('signing_sessions')
    .insert({
      user_id:              opts.userId,
      title:                opts.title,
      pdf_path:             opts.pdfPath,
      document_id:          opts.documentId   ?? null,
      property_id:          opts.propertyId   ?? null,
      lead_id:              opts.leadId        ?? null,
      contact_id:           opts.contactId     ?? null,
      deal_id:              opts.dealId        ?? null,
      blueprint_version_id: opts.blueprintVersionId ?? null,
      status:               'draft',
      fields:               [],
      signers:              [],
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create signing session')
  return data.id
}

// ─── Assign roles ─────────────────────────────────────────────────────────────

export async function assignSignerRoles(
  sessionId: string,
  assignments: RoleAssignmentInput[],
): Promise<void> {
  if (assignments.length === 0) return

  // Delete any existing role assignments for this session (idempotent reassign)
  await serviceClient
    .from('signing_role_assignments')
    .delete()
    .eq('signing_session_id', sessionId)

  const rows = assignments.map(a => ({
    signing_session_id: sessionId,
    signer_role_id:     a.signerRoleId,
    name:               a.name,
    email:              a.email,
    phone:              a.phone ?? null,
    contact_id:         a.contactId ?? null,
    signing_order:      a.signingOrder,
    status:             'pending',
  }))

  const { error } = await serviceClient
    .from('signing_role_assignments')
    .insert(rows)

  if (error) throw new Error(error.message)
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export async function sendSigningSession(
  sessionId: string,
  userId: string,
): Promise<SentSigner[]> {
  // Load session + role assignments + role metadata in parallel
  const [sessionRes, assignmentsRes] = await Promise.all([
    serviceClient
      .from('signing_sessions')
      .select('id, title, status')
      .eq('id', sessionId)
      .single(),
    serviceClient
      .from('signing_role_assignments')
      .select('id, name, email, token, signer_role_id, signing_order')
      .eq('signing_session_id', sessionId)
      .eq('status', 'pending')
      .order('signing_order', { ascending: true }),
  ])

  if (!sessionRes.data) throw new Error('Session not found')
  if (!assignmentsRes.data?.length) throw new Error('No pending role assignments to send')

  // Load role names for email context
  const roleIds = [...new Set(assignmentsRes.data.map(a => a.signer_role_id))]
  const { data: roles } = await serviceClient
    .from('signer_roles')
    .select('id, name')
    .in('id', roleIds)
  const roleNameById: Record<string, string> = {}
  for (const r of roles ?? []) roleNameById[r.id] = r.name

  // Update session status
  await serviceClient
    .from('signing_sessions')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  // Update assignment status to 'sent'
  await serviceClient
    .from('signing_role_assignments')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('signing_session_id', sessionId)

  const baseUrl   = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nextkeyos.vercel.app'
  const session   = sessionRes.data
  const sentList: SentSigner[] = []

  // Load sender name for email
  const { data: profile } = await serviceClient
    .from('user_profiles')
    .select('my_name, display_name')
    .eq('id', userId)
    .single()
  const senderName = (profile as Record<string, string> | null)?.my_name
    || (profile as Record<string, string> | null)?.display_name
    || 'Your agent'

  // Send emails best-effort
  try {
    const { sendEmail, getTokenRecord } = await import('@/lib/gmail')
    const gmailToken = await getTokenRecord(userId)

    for (const a of assignmentsRes.data) {
      const roleName   = roleNameById[a.signer_role_id] ?? 'Signer'
      const signingUrl = `${baseUrl}/sign/${a.token}`

      sentList.push({ id: a.id, name: a.name, email: a.email, role_name: roleName, signing_url: signingUrl })

      if (gmailToken) {
        const body = `
<p>Hi ${a.name.split(' ')[0] || a.name},</p>
<p>${senderName} has requested your signature on <strong>${session.title}</strong>.</p>
<p>Your role: <strong>${roleName}</strong></p>
<p style="margin:24px 0;">
  <a href="${signingUrl}" style="display:inline-block;padding:12px 28px;background:#0A1F44;color:#C9A84C;font-weight:bold;border-radius:8px;text-decoration:none;font-size:15px;">
    Review &amp; Sign Document
  </a>
</p>
<p style="color:#888;font-size:12px;">This link is unique to you. Do not share it. It expires in 30 days.</p>
<p style="color:#888;font-size:12px;">Powered by NextKey OS</p>
`.trim()

        await sendEmail(userId, {
          to:      a.email,
          subject: `Please sign: ${session.title}`,
          body,
        }).catch(() => { /* non-fatal */ })
      }
    }
  } catch { /* gmail not connected — links still returned */ }

  return sentList
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getSessionWithRoles(sessionId: string): Promise<SessionWithRoles | null> {
  const { data: session } = await serviceClient
    .from('signing_sessions')
    .select('id, title, status, pdf_path, document_id, blueprint_version_id, property_id, created_at')
    .eq('id', sessionId)
    .single()

  if (!session) return null

  const { data: assignments } = await serviceClient
    .from('signing_role_assignments')
    .select(`
      id, signer_role_id, name, email, phone, signing_order,
      status, token, signed_at, viewed_at,
      signer_roles ( name, color )
    `)
    .eq('signing_session_id', sessionId)
    .order('signing_order', { ascending: true })

  return {
    ...session,
    role_assignments: (assignments ?? []).map(a => ({
      id:            a.id,
      signer_role_id:a.signer_role_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      role_name:     (a as any).signer_roles?.name ?? '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      color:         (a as any).signer_roles?.color ?? '#4CAF9A',
      name:          a.name,
      email:         a.email,
      phone:         a.phone ?? null,
      signing_order: a.signing_order,
      status:        a.status,
      token:         a.token,
      signed_at:     a.signed_at ?? null,
      viewed_at:     a.viewed_at ?? null,
    })),
  }
}
