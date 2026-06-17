import { NextRequest, NextResponse } from 'next/server'
import { serviceClient } from '@/lib/supabase-service'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ token: string }> }

// ── GET — public: load signer's view ─────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params

  // Try session signer first (new flow)
  const { data: signerRow } = await serviceClient
    .from('session_signers')
    .select('id, session_id, signer_ref_id, name, email, role, color, status')
    .eq('token', token)
    .single()

  if (signerRow) {
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
      session_id: session.id,
      title: session.title,
      signer_name: signerRow.name,
      signer_email: signerRow.email,
      signer_role: signerRow.role,
      signer_color: signerRow.color,
      signer_ref_id: signerRow.signer_ref_id,
      pdf_url: urlData?.signedUrl ?? null,
      fields: myFields,
    })
  }

  // ── Fallback: legacy signing_requests ──────────────────────────────────────
  const { data: req } = await serviceClient
    .from('signing_requests')
    .select('id, document_id, recipient_email, recipient_name, message, status, expires_at, documents(name, pdf_path, signed_pdf_path, file_path)')
    .eq('token', token)
    .single()

  if (!req) return NextResponse.json({ error: 'Invalid or expired signing link.' }, { status: 404 })
  if (req.status === 'signed')   return NextResponse.json({ error: 'This document has already been signed.', errorStatus: 'signed' }, { status: 410 })
  if (req.status === 'declined') return NextResponse.json({ error: 'This signing request was declined.', errorStatus: 'declined' }, { status: 410 })
  if (new Date(req.expires_at) < new Date()) return NextResponse.json({ error: 'This signing link has expired.', errorStatus: 'expired' }, { status: 410 })

  const doc = req.documents as unknown as Record<string, string> | null
  const filePath = doc?.signed_pdf_path || doc?.pdf_path || doc?.file_path
  let pdfUrl: string | null = null
  if (filePath) {
    const { data: urlData } = await serviceClient.storage.from('documents').createSignedUrl(filePath, 3600)
    pdfUrl = urlData?.signedUrl ?? null
  }

  if (req.status === 'pending') {
    await serviceClient.from('signing_requests').update({
      status: 'viewed', viewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('token', token)
  }

  return NextResponse.json({
    flow: 'legacy',
    document_name: doc?.name ?? 'Document',
    recipient_name: req.recipient_name,
    recipient_email: req.recipient_email,
    message: req.message,
    expires_at: req.expires_at,
    pdf_url: pdfUrl,
  })
}

// ── POST — public: submit signed fields / decline ─────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params
  const body = await req.json()
  const { action, fields_data, signer_name, signature_data, decline_reason } = body

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown'
  const ua = req.headers.get('user-agent') ?? ''

  // ── Session flow ────────────────────────────────────────────────────────────
  const { data: signerRow } = await serviceClient
    .from('session_signers')
    .select('id, session_id, signer_ref_id, name, email, status')
    .eq('token', token)
    .single()

  if (signerRow) {
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

    await serviceClient.from('session_signers').update({
      status: 'signed', signed_at: new Date().toISOString(),
      signer_ip: ip, signer_ua: ua, fields_data: fields_data ?? {},
      updated_at: new Date().toISOString(),
    }).eq('token', token)

    const { data: allRows } = await serviceClient
      .from('session_signers')
      .select('status')
      .eq('session_id', signerRow.session_id)

    const allSigned = (allRows ?? []).every(r => r.status === 'signed')
    if (allSigned) {
      triggerComplete(signerRow.session_id).catch(() => {})
    }

    return NextResponse.json({ ok: true, status: 'signed', all_signed: allSigned })
  }

  // ── Legacy flow ─────────────────────────────────────────────────────────────
  const { data: legacyReq } = await serviceClient
    .from('signing_requests')
    .select('id, document_id, user_id, recipient_email, recipient_name, status, expires_at, documents(name, pdf_path, signed_pdf_path, file_path)')
    .eq('token', token)
    .single()

  if (!legacyReq) return NextResponse.json({ error: 'Invalid signing link.' }, { status: 404 })
  if (legacyReq.status === 'signed')   return NextResponse.json({ error: 'Already signed.' }, { status: 410 })
  if (legacyReq.status === 'declined') return NextResponse.json({ error: 'Already declined.' }, { status: 410 })
  if (new Date(legacyReq.expires_at) < new Date()) return NextResponse.json({ error: 'Link expired.' }, { status: 410 })

  if (action === 'decline') {
    await serviceClient.from('signing_requests').update({
      status: 'declined', declined_at: new Date().toISOString(),
      decline_reason: decline_reason ?? null, signer_ip: ip, updated_at: new Date().toISOString(),
    }).eq('token', token)
    await serviceClient.from('document_activity').insert({
      document_id: legacyReq.document_id, action: 'signature_declined',
      notes: `Declined by ${legacyReq.recipient_email}`,
    })
    return NextResponse.json({ ok: true, status: 'declined' })
  }

  if (!signature_data) return NextResponse.json({ error: 'signature_data required' }, { status: 400 })

  const doc = legacyReq.documents as unknown as Record<string, string> | null
  const filePath = doc?.signed_pdf_path || doc?.pdf_path || doc?.file_path
  if (!filePath) return NextResponse.json({ error: 'No PDF found.' }, { status: 500 })

  const { data: fileData } = await serviceClient.storage.from('documents').download(filePath)
  if (!fileData) return NextResponse.json({ error: 'Could not load document.' }, { status: 500 })

  const pdfBytes = await fileData.arrayBuffer()
  const pdfDoc  = await PDFDocument.load(pdfBytes)
  const pages   = pdfDoc.getPages()
  const lastPage = pages[pages.length - 1]
  const { width, height } = lastPage.getSize()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const signedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const signerDisplay = signer_name || legacyReq.recipient_name || legacyReq.recipient_email

  lastPage.drawRectangle({ x: 40, y: 70, width: width - 80, height: 64, color: rgb(0.97, 0.97, 0.97), borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 })
  lastPage.drawText('DIGITALLY SIGNED', { x: 50, y: 120, size: 7, font, color: rgb(0.5, 0.5, 0.5) })
  lastPage.drawText(signerDisplay, { x: 50, y: 104, size: 12, font, color: rgb(0.1, 0.13, 0.27) })
  lastPage.drawText(`${signedAt}  ·  IP: ${ip}`, { x: 50, y: 78, size: 7, font, color: rgb(0.5, 0.5, 0.5) })

  if (signature_data?.startsWith('data:image/png;base64,')) {
    try {
      const imgBytes = Uint8Array.from(Buffer.from(signature_data.replace('data:image/png;base64,', ''), 'base64'))
      const sigImage = await pdfDoc.embedPng(imgBytes)
      lastPage.drawImage(sigImage, { x: width - 210, y: 80, width: 160, height: 50, opacity: 0.9 })
    } catch { /* skip */ }
  }

  const signedPdfBytes = await pdfDoc.save()
  const signedPath = filePath.replace(/\.pdf$/i, '') + `_signed_${Date.now()}.pdf`

  const { error: uploadErr } = await serviceClient.storage
    .from('documents')
    .upload(signedPath, signedPdfBytes, { contentType: 'application/pdf', upsert: true })

  if (uploadErr) return NextResponse.json({ error: 'Could not save signed PDF.' }, { status: 500 })

  await serviceClient.from('signing_requests').update({
    status: 'signed', signed_at: new Date().toISOString(),
    signer_ip: ip, signer_user_agent: ua, signature_data, signed_pdf_path: signedPath,
    updated_at: new Date().toISOString(),
  }).eq('token', token)

  await serviceClient.from('documents').update({
    status: 'fully_signed', signed_pdf_path: signedPath, updated_at: new Date().toISOString(),
  }).eq('id', legacyReq.document_id)

  await serviceClient.from('document_activity').insert({
    document_id: legacyReq.document_id, action: 'signed',
    notes: `Signed by ${legacyReq.recipient_email} on ${signedAt}`,
  })

  return NextResponse.json({ ok: true, status: 'signed' })
}

// Auto-complete signing session when all signers done
async function triggerComplete(sessionId: string) {
  const [{ data: session }, { data: signerRows }] = await Promise.all([
    serviceClient.from('signing_sessions').select('*').eq('id', sessionId).single(),
    serviceClient.from('session_signers').select('*').eq('session_id', sessionId),
  ])
  if (!session) return

  const { data: pdfFile } = await serviceClient.storage.from('documents').download(session.pdf_path as string)
  if (!pdfFile) return

  const pdfBytes = await pdfFile.arrayBuffer()
  const pdfDoc   = await PDFDocument.load(pdfBytes)
  const pages    = pdfDoc.getPages()
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const fields = (session.fields as { id: string; type: string; page: number; x: number; y: number; w: number; h: number; signer_id: string }[]) ?? []
  const fieldsDataMap: Record<string, Record<string, string>> = {}
  for (const row of (signerRows ?? [])) {
    fieldsDataMap[row.signer_ref_id] = (row.fields_data as Record<string, string>) ?? {}
  }

  for (const field of fields) {
    const page = pages[field.page - 1]; if (!page) continue
    const { width: pw, height: ph } = page.getSize()
    const fx = field.x * pw
    const fy = ph - (field.y * ph) - (field.h * ph)
    const fw = field.w * pw
    const fh = field.h * ph
    const signerRow = (signerRows ?? []).find(r => r.signer_ref_id === field.signer_id)
    const value = signerRow ? fieldsDataMap[signerRow.signer_ref_id]?.[field.id] : undefined
    if (!value) continue

    if ((field.type === 'signature' || field.type === 'initials') && value.startsWith('data:image/png;base64,')) {
      try {
        const img = await pdfDoc.embedPng(Uint8Array.from(Buffer.from(value.replace('data:image/png;base64,', ''), 'base64')))
        page.drawImage(img, { x: fx, y: fy, width: fw, height: fh, opacity: 0.95 })
      } catch { /* skip */ }
    } else if (field.type === 'signature' || field.type === 'initials') {
      const fontSize = Math.min(fh * 0.6, 18)
      page.drawText(value, { x: fx + 4, y: fy + fh / 2 - fontSize / 2, size: fontSize, font: fontItalic, color: rgb(0.04, 0.08, 0.26) })
    } else if (field.type === 'date' || field.type === 'text') {
      const fontSize = Math.min(fh * 0.55, 11)
      page.drawText(value, { x: fx + 4, y: fy + fh / 2 - fontSize / 2, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) })
    } else if (field.type === 'checkbox' && value === 'checked') {
      page.drawText('✓', { x: fx + fw / 4, y: fy + fh / 4, size: Math.min(fw, fh) * 0.7, font, color: rgb(0.04, 0.08, 0.26) })
    }
  }

  const completedPdfBytes = await pdfDoc.save()
  const completedPath = `signed/${session.user_id}/${sessionId}_completed_${Date.now()}.pdf`
  const { error } = await serviceClient.storage.from('documents').upload(completedPath, completedPdfBytes, { contentType: 'application/pdf', upsert: true })
  if (error) return

  await serviceClient.from('signing_sessions').update({
    status: 'completed', completed_pdf_path: completedPath,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', sessionId)

  // Auto-link the completed PDF as a permanent documents record so it appears
  // in Document Center, and any linked Contact / Deal / Lead / Property tabs.
  try {
    await serviceClient.from('documents').insert({
      name:            `${String(session.title ?? 'Signed Document')} — Fully Signed`,
      category:        'contract',
      status:          'fully_signed',
      signed_pdf_path: completedPath,
      property_id:     (session.property_id as string | null) ?? null,
      lead_id:         (session.lead_id     as string | null) ?? null,
      contact_id:      (session.contact_id  as string | null) ?? null,
      deal_id:         (session.deal_id     as string | null) ?? null,
      created_by:      session.user_id as string,
      created_at:      new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    })
  } catch { /* best-effort */ }
}
