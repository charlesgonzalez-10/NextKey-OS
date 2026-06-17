/**
 * Document Service — central layer for all document lifecycle operations.
 *
 * Every document action (create, upload, status change, signature request,
 * event logging) flows through this service. It enforces the lifecycle model,
 * links signing sessions to their source documents, and writes a complete
 * audit trail to document_activity.
 *
 * Architecture:
 *   Component/API Route → documentService
 *                       → documents table
 *                       → document_activity  (append-only audit log)
 *                       → signing_sessions   (linked via document_id)
 *                       → document_versions  (on version bump)
 */

import { serviceClient } from './supabase-service'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocumentStatus =
  | 'draft'
  | 'generated'
  | 'signed_by_me'
  | 'pending_signature'
  | 'partially_signed'
  | 'sent'
  | 'viewed'
  | 'fully_signed'
  | 'accepted'
  | 'rejected'
  | 'executed'
  | 'expired'
  | 'cancelled'
  | 'voided'
  | 'archived'

export type DocumentType = 'generated' | 'uploaded' | 'received'

export type DocumentActivity =
  | 'created' | 'generated' | 'uploaded' | 'signed' | 'sent' | 'viewed'
  | 'accepted' | 'rejected' | 'version_saved' | 'signature_requested'
  | 'signature_viewed' | 'signature_signed' | 'signature_declined'
  | 'fully_signed' | 'executed' | 'voided' | 'status_changed'
  | 'downloaded' | 'shared'

export interface DocumentRecord {
  id:                  string
  name:                string
  category:            string
  status:              DocumentStatus
  document_type:       DocumentType
  template_id:         string | null
  property_id:         string | null
  lead_id:             string | null
  contact_id:          string | null
  deal_id:             string | null
  offer_amount:        number | null
  recipient_name:      string | null
  recipient_email:     string | null
  pdf_path:            string | null
  signed_pdf_path:     string | null
  file_path:           string | null
  file_type:           string | null
  signing_session_id:  string | null
  version:             number
  is_executed:         boolean
  executed_at:         string | null
  sent_at:             string | null
  expires_at:          string | null
  filled_data:         Record<string, string> | null
  ocr_status:          string
  ai_summary:          string | null
  ai_extracted:        Record<string, unknown> | null
  created_by:          string | null
  created_at:          string
  updated_at:          string
  deleted_at:          string | null
}

export interface SignerSpec {
  id:    string   // signer_ref_id — any unique string within this session
  name:  string
  email: string
  role?: string
  color?: string
}

export interface CreateSignatureRequestOpts {
  documentId:  string
  pdfPath:     string           // storage path of the document PDF
  title:       string
  signers:     SignerSpec[]
  fields?:     unknown[]        // field positions (optional for quick send)
  userId:      string
  propertyId?: string | null
  leadId?:     string | null
  contactId?:  string | null
  dealId?:     string | null
}

export interface LogEventOpts {
  documentId: string
  action:     DocumentActivity
  notes?:     string
  userId?:    string
  newStatus?: DocumentStatus
}

// ─── Document queries ─────────────────────────────────────────────────────────

/**
 * Fetch all non-deleted documents for a property, ordered newest first.
 */
export async function getTransactionDocuments(propertyId: string): Promise<DocumentRecord[]> {
  const { data } = await serviceClient
    .from('documents')
    .select(`
      id, name, category, status, document_type, template_id,
      property_id, lead_id, contact_id, deal_id,
      offer_amount, recipient_name, recipient_email,
      pdf_path, signed_pdf_path, file_path, file_type,
      signing_session_id, version, is_executed, executed_at,
      sent_at, expires_at, filled_data,
      ocr_status, ai_summary, ai_extracted,
      created_by, created_at, updated_at, deleted_at
    `)
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return (data ?? []) as DocumentRecord[]
}

/**
 * Fetch a single document by id. Returns null if not found or soft-deleted.
 */
export async function getDocument(documentId: string): Promise<DocumentRecord | null> {
  const { data } = await serviceClient
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle()

  return data as DocumentRecord | null
}

// ─── Status transitions ───────────────────────────────────────────────────────

/**
 * Update a document's status and log the change to document_activity.
 */
export async function updateDocumentStatus(
  documentId: string,
  newStatus:  DocumentStatus,
  userId:     string,
  notes?:     string
): Promise<void> {
  await serviceClient
    .from('documents')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', documentId)

  await logEvent({ documentId, action: 'status_changed', notes, userId, newStatus })
}

/**
 * Mark a document as executed (fully signed + countersigned + dated).
 */
export async function markExecuted(documentId: string, userId: string): Promise<void> {
  const now = new Date().toISOString()
  await serviceClient
    .from('documents')
    .update({ status: 'executed', is_executed: true, executed_at: now, updated_at: now })
    .eq('id', documentId)

  await logEvent({ documentId, action: 'executed', userId })
}

/**
 * Soft-delete a document. Does not remove storage files.
 * Physical file cleanup can be run as a separate background job.
 */
export async function softDelete(documentId: string, userId: string): Promise<void> {
  await serviceClient
    .from('documents')
    .update({ deleted_at: new Date().toISOString(), status: 'archived' })
    .eq('id', documentId)

  await logEvent({ documentId, action: 'status_changed', notes: 'Document deleted', userId })
}

// ─── Signature request ────────────────────────────────────────────────────────

/**
 * Create a signing session linked to a document.
 *
 * This is the primary path for requesting signatures — it creates the session,
 * sets the document_id FK, then updates the document status to pending_signature.
 *
 * Returns the created signing_session id.
 */
export async function requestSignatures(opts: CreateSignatureRequestOpts): Promise<string> {
  const { documentId, pdfPath, title, signers, fields = [], userId,
          propertyId, leadId, contactId, dealId } = opts

  // Create the signing session
  const { data: session, error } = await serviceClient
    .from('signing_sessions')
    .insert({
      user_id:     userId,
      document_id: documentId,
      title,
      pdf_path:    pdfPath,
      status:      'draft',
      fields:      fields,
      signers:     signers,
      property_id: propertyId ?? null,
      lead_id:     leadId     ?? null,
      contact_id:  contactId  ?? null,
      deal_id:     dealId     ?? null,
    })
    .select('id')
    .single()

  if (error || !session) throw new Error(error?.message ?? 'Failed to create signing session')

  const sessionId = session.id as string

  // Link the session back to the document
  await serviceClient
    .from('documents')
    .update({
      signing_session_id: sessionId,
      status:             'pending_signature',
      updated_at:         new Date().toISOString(),
    })
    .eq('id', documentId)

  await logEvent({
    documentId,
    action: 'signature_requested',
    notes:  `${signers.length} signer(s) invited`,
    userId,
    newStatus: 'pending_signature',
  })

  return sessionId
}

// ─── Version management ───────────────────────────────────────────────────────

/**
 * Bump the version counter and snapshot the current file path to document_versions.
 * Call this BEFORE overwriting pdf_path or file_path.
 */
export async function snapshotVersion(
  documentId: string,
  userId: string,
  notes?: string
): Promise<void> {
  const doc = await getDocument(documentId)
  if (!doc) return

  const nextVersion = (doc.version ?? 1) + 1

  await Promise.all([
    serviceClient.from('document_versions').insert({
      document_id: documentId,
      version:     doc.version ?? 1,
      file_path:   doc.signed_pdf_path ?? doc.pdf_path ?? doc.file_path,
      notes,
      created_by:  userId,
    }),
    serviceClient.from('documents').update({ version: nextVersion }).eq('id', documentId),
  ])

  await logEvent({ documentId, action: 'version_saved', notes, userId })
}

// ─── Audit log ────────────────────────────────────────────────────────────────

/**
 * Append an event to document_activity. Never throws — fire-and-forget safe.
 */
export async function logEvent(opts: LogEventOpts): Promise<void> {
  try {
    await serviceClient.from('document_activity').insert({
      document_id: opts.documentId,
      action:      opts.action,
      notes:       opts.notes ?? null,
      created_by:  opts.userId ?? null,
      ...(opts.newStatus ? { new_status: opts.newStatus } : {}),
    })
  } catch {
    // audit failures are non-fatal
  }
}

// ─── Signing session summary ──────────────────────────────────────────────────

export interface SigningSessionSummary {
  id:             string
  status:         string
  total_signers:  number
  signed_count:   number
  pending_count:  number
  completed_at:   string | null
}

/**
 * Fetch signing progress for a list of session ids in a single round-trip.
 */
export async function getSigningSessionSummaries(
  sessionIds: string[]
): Promise<Record<string, SigningSessionSummary>> {
  if (!sessionIds.length) return {}

  const [sessionsRes, signersRes] = await Promise.all([
    serviceClient
      .from('signing_sessions')
      .select('id, status, completed_at')
      .in('id', sessionIds),
    serviceClient
      .from('session_signers')
      .select('session_id, status')
      .in('session_id', sessionIds),
  ])

  const sessions = sessionsRes.data ?? []
  const signers  = signersRes.data ?? []

  const result: Record<string, SigningSessionSummary> = {}

  for (const s of sessions) {
    const mySigners = signers.filter(r => r.session_id === s.id)
    result[s.id] = {
      id:            s.id,
      status:        s.status,
      total_signers: mySigners.length,
      signed_count:  mySigners.filter(r => r.status === 'signed').length,
      pending_count: mySigners.filter(r => r.status === 'pending' || r.status === 'viewed').length,
      completed_at:  s.completed_at ?? null,
    }
  }

  return result
}

// ─── Document grouping helper ─────────────────────────────────────────────────

export const CATEGORY_GROUPS: { label: string; categories: string[] }[] = [
  {
    label:      'Contracts & Purchase Agreements',
    categories: ['contract', 'offer'],
  },
  {
    label:      'Letters of Intent & Assignments',
    categories: ['loi', 'assignment'],
  },
  {
    label:      'Disclosures & Addenda',
    categories: ['disclosure'],
  },
  {
    label:      'Closing Documents',
    categories: ['closing', 'title'],
  },
  {
    label:      'Seller & Buyer Docs',
    categories: ['seller', 'buyer'],
  },
  {
    label:      'Correspondence',
    categories: ['letter', 'marketing'],
  },
  {
    label:      'Supporting Documents',
    categories: ['photo', 'probate', 'foreclosure', 'other'],
  },
]

export function groupDocuments(docs: DocumentRecord[]): { label: string; docs: DocumentRecord[] }[] {
  return CATEGORY_GROUPS
    .map(g => ({
      label: g.label,
      docs:  docs.filter(d => g.categories.includes(d.category)),
    }))
    .filter(g => g.docs.length > 0)
}
