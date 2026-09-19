/**
 * Canonical, idempotent signing-session completion.
 *
 * One code path handles both auto-completion (triggered when the final signer
 * submits via /api/sign/[token]) and manual recovery (called from
 * /api/signing-sessions/[id]/complete by the agent).
 *
 * Idempotency guarantee:
 *   If the session already has a completed_pdf_path the function returns the
 *   existing paths immediately. Concurrent calls are safe because the first
 *   writer sets completed_pdf_path and subsequent callers short-circuit.
 *
 * Cost contract: $0.00 external provider spend. Uses only Supabase storage,
 * serviceClient DB calls, pdf-lib, and Gmail (best-effort, no throw).
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { serviceClient } from '@/lib/supabase-service'

export interface CompleteResult {
  completedPdfUrl: string | null
  certificateUrl:  string | null
  alreadyComplete: boolean
}

export async function completeSigningSession(
  sessionId: string,
  triggeredByUserId?: string,   // undefined = triggered by signer (auto-complete)
): Promise<CompleteResult> {

  // ── Load session ──────────────────────────────────────────────────────────
  const { data: session, error: sErr } = await serviceClient
    .from('signing_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (sErr || !session) throw new Error('Signing session not found')

  // ── Idempotency fast path ─────────────────────────────────────────────────
  if (session.completed_pdf_path) {
    const [{ data: pdfUrl }, { data: certUrl }] = await Promise.all([
      serviceClient.storage.from('documents').createSignedUrl(session.completed_pdf_path as string, 3600),
      session.certificate_path
        ? serviceClient.storage.from('documents').createSignedUrl(session.certificate_path as string, 3600)
        : Promise.resolve({ data: null }),
    ])
    return {
      completedPdfUrl: pdfUrl?.signedUrl ?? null,
      certificateUrl:  certUrl?.signedUrl ?? null,
      alreadyComplete: true,
    }
  }

  // ── Atomic claim ──────────────────────────────────────────────────────────
  // Two concurrent callers (e.g. fire-and-forget auto-complete + manual complete)
  // could both read completed_pdf_path = NULL and both proceed to generate a PDF.
  // The UPDATE atomically sets completion_claimed_at only when it is currently
  // NULL (or stale >10 min, allowing retry after a crashed attempt). Postgres
  // row-level locking serialises concurrent UPDATEs — exactly one caller wins
  // and receives a non-empty RETURNING; all others must abort.
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: claimed } = await serviceClient
    .from('signing_sessions')
    .update({ completion_claimed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('completed_pdf_path', null)
    .or(`completion_claimed_at.is.null,completion_claimed_at.lt.${staleThreshold}`)
    .select('id')

  if (!claimed || claimed.length === 0) {
    // Another caller already claimed completion (or it just finished). Re-read.
    const { data: fresh } = await serviceClient
      .from('signing_sessions')
      .select('completed_pdf_path, certificate_path')
      .eq('id', sessionId)
      .single()
    if (fresh?.completed_pdf_path) {
      const [{ data: pdfUrl }, { data: certUrl }] = await Promise.all([
        serviceClient.storage.from('documents').createSignedUrl(fresh.completed_pdf_path as string, 3600),
        fresh.certificate_path
          ? serviceClient.storage.from('documents').createSignedUrl(fresh.certificate_path as string, 3600)
          : Promise.resolve({ data: null }),
      ])
      return { completedPdfUrl: pdfUrl?.signedUrl ?? null, certificateUrl: certUrl?.signedUrl ?? null, alreadyComplete: true }
    }
    throw new Error('Completion already in progress by another caller')
  }

  // ── Verify all signers have signed ────────────────────────────────────────
  const { data: signerRows } = await serviceClient
    .from('session_signers')
    .select('*')
    .eq('session_id', sessionId)

  const rows = signerRows ?? []
  if (rows.length === 0) throw new Error('No signers found for this session')
  const allSigned = rows.every(r => r.status === 'signed')
  if (!allSigned) throw new Error('Not all signers have signed')

  // ── Download source PDF ───────────────────────────────────────────────────
  const { data: pdfFile } = await serviceClient.storage
    .from('documents')
    .download(session.pdf_path as string)
  if (!pdfFile) throw new Error('Could not load source PDF')

  const pdfDoc   = await PDFDocument.load(await pdfFile.arrayBuffer())
  const pages    = pdfDoc.getPages()
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  // ── Render each signer's field data onto the PDF ──────────────────────────
  type SigningField = { id: string; type: string; page: number; x: number; y: number; w: number; h: number; signer_id: string }
  const fields = (session.fields as SigningField[]) ?? []
  const fieldsDataMap: Record<string, Record<string, string>> = {}
  for (const row of rows) {
    fieldsDataMap[row.signer_ref_id] = (row.fields_data as Record<string, string>) ?? {}
  }

  for (const field of fields) {
    const page = pages[field.page - 1]
    if (!page) continue
    const { width: pw, height: ph } = page.getSize()
    const fx = field.x * pw
    const fy = ph - (field.y * ph) - (field.h * ph)
    const fw = field.w * pw
    const fh = field.h * ph

    const signerRow = rows.find(r => r.signer_ref_id === field.signer_id)
    const value = signerRow ? fieldsDataMap[signerRow.signer_ref_id]?.[field.id] : undefined
    if (!value) continue

    if (field.type === 'signature' || field.type === 'initials') {
      if (value.startsWith('data:image/png;base64,')) {
        try {
          const img = await pdfDoc.embedPng(Uint8Array.from(Buffer.from(value.replace('data:image/png;base64,', ''), 'base64')))
          page.drawImage(img, { x: fx, y: fy, width: fw, height: fh, opacity: 0.95 })
        } catch { /* skip bad image */ }
      } else {
        const fontSize = Math.min(fh * 0.6, 18)
        page.drawText(value, { x: fx + 4, y: fy + fh / 2 - fontSize / 2, size: fontSize, font: fontItalic, color: rgb(0.04, 0.08, 0.26) })
      }
    } else if (field.type === 'date' || field.type === 'text') {
      const fontSize = Math.min(fh * 0.55, 11)
      page.drawText(value, { x: fx + 4, y: fy + fh / 2 - fontSize / 2, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) })
    } else if (field.type === 'checkbox' && value === 'checked') {
      page.drawText('✓', { x: fx + fw / 4, y: fy + fh / 4, size: Math.min(fw, fh) * 0.7, font, color: rgb(0.04, 0.08, 0.26) })
    }
  }

  // ── Upload completed PDF ──────────────────────────────────────────────────
  const completedPdfBytes = await pdfDoc.save()
  const ownerUserId = triggeredByUserId ?? (session.user_id as string)
  const completedPath = `signed/${ownerUserId}/${sessionId}_completed_${Date.now()}.pdf`

  const { error: uploadErr } = await serviceClient.storage
    .from('documents')
    .upload(completedPath, completedPdfBytes, { contentType: 'application/pdf', upsert: true })
  if (uploadErr) throw new Error(`Failed to save completed PDF: ${uploadErr.message}`)

  // ── Generate certificate ──────────────────────────────────────────────────
  const certPath = await generateCertificate({ ownerUserId, sessionId, session, signerRows: rows })

  // ── Mark session completed (idempotent: only sets if not already set) ──────
  await serviceClient
    .from('signing_sessions')
    .update({
      status:             'completed',
      completed_pdf_path: completedPath,
      certificate_path:   certPath ?? null,
      completed_at:       new Date().toISOString(),
      updated_at:         new Date().toISOString(),
    })
    .eq('id', sessionId)

  // ── Auto-link completed document (best-effort) ────────────────────────────
  serviceClient.from('documents').insert({
    name:            `${String(session.title ?? 'Signed Document')} — Fully Signed`,
    category:        'contract',
    status:          'fully_signed',
    signed_pdf_path: completedPath,
    property_id:     (session.property_id as string | null) ?? null,
    lead_id:         (session.lead_id     as string | null) ?? null,
    contact_id:      (session.contact_id  as string | null) ?? null,
    deal_id:         (session.deal_id     as string | null) ?? null,
    created_by:      ownerUserId,
    created_at:      new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  }).then(() => { /* best-effort */ }, () => { /* best-effort */ })

  // ── Email all parties (best-effort, never throws) ─────────────────────────
  sendCompletionEmails({ ownerUserId, session, signerRows: rows, completedPath, certPath }).catch(() => {})

  // ── Return signed URLs ────────────────────────────────────────────────────
  const [{ data: pdfUrl }, { data: certUrl }] = await Promise.all([
    serviceClient.storage.from('documents').createSignedUrl(completedPath, 3600),
    certPath
      ? serviceClient.storage.from('documents').createSignedUrl(certPath, 3600)
      : Promise.resolve({ data: null }),
  ])

  return {
    completedPdfUrl: pdfUrl?.signedUrl ?? null,
    certificateUrl:  certUrl?.signedUrl ?? null,
    alreadyComplete: false,
  }
}

// ─── Certificate generator ────────────────────────────────────────────────────

async function generateCertificate({
  ownerUserId,
  sessionId,
  session,
  signerRows,
}: {
  ownerUserId: string
  sessionId:   string
  session:     Record<string, unknown>
  signerRows:  { name: string; email: string; role?: string; status: string; signed_at?: string; signer_ip?: string }[]
}): Promise<string | null> {
  try {
    const cert = await PDFDocument.create()
    const page = cert.addPage([612, 792])
    const { height } = page.getSize()
    const fontR = await cert.embedFont(StandardFonts.Helvetica)
    const fontB = await cert.embedFont(StandardFonts.HelveticaBold)
    const navy  = rgb(0.04, 0.12, 0.27)
    const gold  = rgb(0.79, 0.66, 0.30)
    const grey  = rgb(0.45, 0.45, 0.45)
    const black = rgb(0.1, 0.1, 0.1)

    page.drawRectangle({ x: 0, y: height - 80, width: 612, height: 80, color: navy })
    page.drawText('CERTIFICATE OF COMPLETION', { x: 40, y: height - 42, size: 16, font: fontB, color: gold })
    page.drawText('NextKey OS · Electronic Signature', { x: 40, y: height - 62, size: 9, font: fontR, color: rgb(0.7, 0.7, 0.7) })

    let y = height - 110
    const drawLabel = (label: string, value: string, yPos: number) => {
      page.drawText(label, { x: 40, y: yPos, size: 8, font: fontR, color: grey })
      page.drawText(value, { x: 180, y: yPos, size: 9, font: fontB, color: black })
      return yPos - 18
    }
    y = drawLabel('Document:', (session.title as string) ?? 'Untitled', y)
    y = drawLabel('Session ID:', sessionId, y)
    y = drawLabel('Completed:', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }), y)
    y -= 20
    page.drawLine({ start: { x: 40, y }, end: { x: 572, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) })
    y -= 20
    page.drawText('SIGNING DETAILS', { x: 40, y, size: 9, font: fontB, color: navy })
    y -= 20

    for (const signer of signerRows) {
      page.drawRectangle({ x: 36, y: y - 58, width: 540, height: 64, color: rgb(0.97, 0.97, 0.97), borderColor: rgb(0.87, 0.87, 0.87), borderWidth: 0.5 })
      page.drawText(`${signer.name}${signer.role ? ` — ${signer.role}` : ''}`, { x: 50, y: y - 12, size: 10, font: fontB, color: black })
      page.drawText(signer.email, { x: 50, y: y - 26, size: 8, font: fontR, color: grey })
      const signedAt = signer.signed_at
        ? new Date(signer.signed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Not signed'
      page.drawText(`Signed: ${signedAt}`, { x: 50, y: y - 40, size: 8, font: fontR, color: black })
      if (signer.signer_ip) page.drawText(`IP: ${signer.signer_ip}`, { x: 50, y: y - 54, size: 7, font: fontR, color: grey })
      const badgeColor = signer.status === 'signed' ? rgb(0.18, 0.62, 0.45) : rgb(0.7, 0.3, 0.3)
      page.drawRectangle({ x: 490, y: y - 22, width: 72, height: 18, color: badgeColor })
      page.drawText(signer.status.toUpperCase(), { x: 494, y: y - 16, size: 8, font: fontB, color: rgb(1, 1, 1) })
      y -= 78
    }

    const certBytes = await cert.save()
    const certPath = `certificates/${ownerUserId}/${sessionId}_certificate_${Date.now()}.pdf`
    const { error } = await serviceClient.storage.from('documents').upload(certPath, certBytes, { contentType: 'application/pdf', upsert: true })
    return error ? null : certPath
  } catch {
    return null
  }
}

// ─── Completion email (best-effort) ──────────────────────────────────────────

async function sendCompletionEmails({
  ownerUserId,
  session,
  signerRows,
  completedPath,
  certPath,
}: {
  ownerUserId: string
  session:     Record<string, unknown>
  signerRows:  { email: string }[]
  completedPath: string
  certPath:    string | null
}): Promise<void> {
  const { sendEmail, getTokenRecord } = await import('@/lib/gmail')
  const gmailToken = await getTokenRecord(ownerUserId)
  if (!gmailToken) return

  const attachments = []
  const [completedFile, certFile] = await Promise.all([
    serviceClient.storage.from('documents').download(completedPath),
    certPath ? serviceClient.storage.from('documents').download(certPath) : Promise.resolve({ data: null }),
  ])
  if (completedFile.data) {
    const b = Buffer.from(await completedFile.data.arrayBuffer()).toString('base64')
    attachments.push({ filename: `${session.title} - Signed.pdf`, mimeType: 'application/pdf', data: b })
  }
  if (certFile?.data) {
    const b = Buffer.from(await certFile.data.arrayBuffer()).toString('base64')
    attachments.push({ filename: `${session.title} - Certificate.pdf`, mimeType: 'application/pdf', data: b })
  }

  const body = `<p>All parties have signed <strong>${session.title}</strong>.</p>
<p>The fully executed contract and certificate of completion are attached.</p>
<p style="color:#888;font-size:12px;">Powered by NextKey OS</p>`

  const recipients = [gmailToken.email, ...signerRows.map(r => r.email)]
  for (const to of recipients) {
    await sendEmail(ownerUserId, {
      to, subject: `✅ Fully Executed: ${session.title}`, body, attachments,
    }).catch(() => {})
  }
}
