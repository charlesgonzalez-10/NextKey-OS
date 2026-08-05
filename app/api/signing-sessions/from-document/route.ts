import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { createSigningSession, assignSignerRoles, sendSigningSession } from '@/lib/documents/signingService'

export const dynamic = 'force-dynamic'

// POST /api/signing-sessions/from-document
// Creates a DBE-aware signing session from a generated document, assigns signer
// roles, and immediately sends signature request emails.
//
// Body:
//   document_id       required — the documents.id to send for signature
//   role_assignments  required — [{ signer_role_id, name, email, phone?, contact_id?, signing_order }]
//
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

  // Load document to get PDF path + blueprint metadata
  const { data: doc } = await serviceClient
    .from('documents')
    .select('id, name, pdf_path, signed_pdf_path, file_path, blueprint_version_id, property_id, lead_id, contact_id, deal_id, created_by')
    .eq('id', document_id)
    .single()

  if (!doc || doc.created_by !== user.id)
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const pdfPath = doc.pdf_path || doc.signed_pdf_path || doc.file_path
  if (!pdfPath)
    return NextResponse.json({ error: 'Document has no PDF' }, { status: 400 })

  try {
    // 1. Create session
    const sessionId = await createSigningSession({
      userId:              user.id,
      title:               doc.name,
      pdfPath,
      documentId:          doc.id,
      propertyId:          doc.property_id,
      leadId:              doc.lead_id,
      contactId:           doc.contact_id,
      dealId:              doc.deal_id,
      blueprintVersionId:  doc.blueprint_version_id,
    })

    // 2. Assign roles
    await assignSignerRoles(
      sessionId,
      role_assignments.map(a => ({
        signerRoleId: a.signer_role_id,
        name:         a.name,
        email:        a.email,
        phone:        a.phone   ?? null,
        contactId:    a.contact_id ?? null,
        signingOrder: a.signing_order,
      })),
    )

    // 3. Send
    const sentSigners = await sendSigningSession(sessionId, user.id)

    // 4. Update document status
    await serviceClient
      .from('documents')
      .update({
        status:             'sent',
        signing_session_id: sessionId,
        updated_at:         new Date().toISOString(),
      })
      .eq('id', document_id)

    return NextResponse.json({ session_id: sessionId, signers: sentSigners }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
