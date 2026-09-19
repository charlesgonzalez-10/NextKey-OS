'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import { groupDocuments, type DocumentRecord } from '@/lib/documentService'
import type { WorkspaceDocument } from '@/lib/acquisitionEngine'

const GenerateContractModal = dynamic(() => import('@/components/GenerateContractModal'), { ssr: false })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtCurrency(n: number | null | undefined) {
  if (!n) return null
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fileExt(doc: WorkspaceDocument) {
  if (doc.file_type) return doc.file_type.toUpperCase()
  if (doc.signed_pdf_path || doc.pdf_path) return 'PDF'
  return 'FILE'
}

// ─── Status badge ─────────────────────────────────────────────────────────────

interface StatusConfig { label: string; color: string; bg: string; dot?: boolean }
const STATUS: Record<string, StatusConfig> = {
  draft:             { label: 'Draft',              color: '#64748b', bg: '#1e293b' },
  generated:         { label: 'Generated',          color: '#818cf8', bg: '#1e1b4b' },
  signed_by_me:      { label: 'Signed by Me',       color: '#C9A84C', bg: '#3d2800' },
  pending_signature: { label: 'Awaiting Signature', color: '#f59e0b', bg: '#3d2800', dot: true },
  partially_signed:  { label: 'Partially Signed',   color: '#f59e0b', bg: '#3d2800', dot: true },
  sent:              { label: 'Sent',               color: '#38bdf8', bg: '#0c2a4a' },
  viewed:            { label: 'Viewed',             color: '#60a5fa', bg: '#1e3a5f' },
  fully_signed:      { label: 'Fully Signed',       color: '#22c55e', bg: '#0f2a18' },
  executed:          { label: 'Executed',           color: '#22c55e', bg: '#0f2a18' },
  accepted:          { label: 'Accepted',           color: '#22c55e', bg: '#0f2a18' },
  rejected:          { label: 'Rejected',           color: '#ef4444', bg: '#2a0f0f' },
  expired:           { label: 'Expired',            color: '#ef4444', bg: '#2a0f0f' },
  cancelled:         { label: 'Cancelled',          color: '#64748b', bg: '#1e293b' },
  voided:            { label: 'Voided',             color: '#64748b', bg: '#1e293b' },
  archived:          { label: 'Archived',           color: '#475569', bg: '#1e293b' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS[status] ?? { label: status, color: '#64748b', bg: '#1e293b' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 10, fontWeight: 500, flexShrink: 0 }}>
      {cfg.dot && (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, animation: 'pulse 2s infinite' }} />
      )}
      {cfg.label}
    </span>
  )
}

// ─── Signing progress pill ────────────────────────────────────────────────────

interface SigningProgress { total: number; signed: number }

function SigningPill({ p }: { p: SigningProgress }) {
  if (p.total === 0) return null
  const done = p.signed >= p.total
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 20, background: done ? '#0f2a18' : '#1a2a10', color: done ? '#22c55e' : '#86efac', fontSize: 10, fontWeight: 500 }}>
      {done ? '✓' : '✍'} {p.signed}/{p.total} signed
    </span>
  )
}

// ─── Upload modal ─────────────────────────────────────────────────────────────

function UploadModal({ propertyId, onClose, onUploaded }: { propertyId: string; onClose: () => void; onUploaded: () => void }) {
  const [files, setFiles]       = useState<File[]>([])
  const [category, setCategory] = useState('other')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const inputRef                = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setFiles(Array.from(e.dataTransfer.files))
  }

  const handleUpload = async () => {
    if (!files.length) return
    setLoading(true)
    setError('')
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    fd.append('property_id', propertyId)
    fd.append('category', category)
    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error('Upload failed')
      onUploaded()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 10, padding: 24, width: 460, maxWidth: '95vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Upload Documents</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          style={{ border: '2px dashed #1a3050', borderRadius: 8, padding: '28px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 14, transition: 'border-color .2s' }}
        >
          {files.length > 0 ? (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              {files.map(f => f.name).join(', ')}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📎</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Click to browse or drag &amp; drop files</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>PDF, Word, Excel, Images</div>
            </>
          )}
          <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.doc,.xlsx,.xls,.jpg,.jpeg,.png,.txt" style={{ display: 'none' }} onChange={e => setFiles(Array.from(e.target.files ?? []))} />
        </div>

        {/* Category */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 10, color: '#4a6a9a', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>Category</label>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ width: '100%', background: '#0a1729', border: '1px solid #1a3050', borderRadius: 5, color: '#e2e8f0', fontSize: 12, padding: '7px 10px' }}>
            {[['offer','Offer'],['loi','LOI'],['assignment','Assignment'],['contract','Contract'],['disclosure','Disclosure'],['letter','Letter'],['photo','Photo'],['closing','Closing'],['probate','Probate'],['foreclosure','Foreclosure'],['title','Title'],['seller','Seller Doc'],['buyer','Buyer Doc'],['marketing','Marketing'],['other','Other']].map(([v,l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        {error && <div style={{ color: '#ef4444', fontSize: 11, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 5, border: '1px solid #1a3050', background: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleUpload} disabled={loading || !files.length} style={{ padding: '7px 16px', borderRadius: 5, border: 'none', background: files.length ? '#C9A84C' : '#374151', color: files.length ? '#060e1a' : '#6b7280', fontSize: 12, fontWeight: 700, cursor: files.length ? 'pointer' : 'not-allowed' }}>
            {loading ? 'Uploading…' : `Upload ${files.length ? `(${files.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Signature request modal ──────────────────────────────────────────────────

interface SignerRow { name: string; email: string; role: string }
interface SigReqModalProps {
  doc:         WorkspaceDocument
  propertyId:  string
  contacts:    { id: string; contact: { name: string; email?: string | null; phone?: string | null } }[]
  onClose:     () => void
  onRequested: (sessionId: string) => void
}

function SignatureRequestModal({ doc, propertyId, contacts, onClose, onRequested }: SigReqModalProps) {
  const [signers, setSigners] = useState<SignerRow[]>([{ name: '', email: '', role: 'seller' }])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const pdfPath = doc.signed_pdf_path ?? doc.pdf_path ?? doc.file_path ?? ''

  const updateSigner = (i: number, field: keyof SignerRow, value: string) => {
    setSigners(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  const fillFromContact = (i: number, contactId: string) => {
    const c = contacts.find(c => c.id === contactId)
    if (c) updateSigner(i, 'name', c.contact.name)
    if (c?.contact.email) updateSigner(i, 'email', c.contact.email)
  }

  const handleSubmit = async () => {
    const valid = signers.filter(s => s.name && s.email)
    if (!valid.length) { setError('Add at least one signer with a name and email.'); return }
    if (!pdfPath)      { setError('Document has no PDF file.'); return }

    setLoading(true)
    setError('')

    try {
      // Create signing session
      const sessionRes = await fetch('/api/signing-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       `Sign: ${doc.name}`,
          pdf_path:    pdfPath,
          fields:      [],
          signers:     valid.map((s, i) => ({ id: `s${i+1}`, name: s.name, email: s.email, role: s.role, color: SIGNER_COLORS[i % SIGNER_COLORS.length] })),
          property_id: propertyId,
          lead_id:     propertyId,
          document_id: doc.id,
        }),
      })
      if (!sessionRes.ok) throw new Error('Failed to create signing session')
      const session = await sessionRes.json()

      // Link session to document + update status
      await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending_signature', signing_session_id: session.id }),
      })

      onRequested(session.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const SIGNER_COLORS = ['#4CAF9A', '#6366f1', '#f59e0b', '#ef4444']
  const ROLES = [['seller','Seller'],['buyer','Buyer'],['agent','Agent'],['attorney','Attorney'],['other','Other']]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 10, padding: 24, width: 500, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Request Signatures</div>
            <div style={{ fontSize: 11, color: '#4a6a9a', marginTop: 2 }}>{doc.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {!pdfPath && (
          <div style={{ background: '#2a1a0a', border: '1px solid #92400e', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#fbbf24', marginBottom: 14, marginTop: 12 }}>
            ⚠ This document doesn't have a PDF file yet. Generate or upload a PDF before requesting signatures.
          </div>
        )}

        <div style={{ margin: '16px 0 8px', fontSize: 10, color: '#4a6a9a', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Signers</div>

        {signers.map((signer, i) => (
          <div key={i} style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 7, padding: '12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: SIGNER_COLORS[i % SIGNER_COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                {i + 1}
              </span>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>Signer {i + 1}</span>
              {signers.length > 1 && (
                <button onClick={() => setSigners(prev => prev.filter((_, idx) => idx !== i))} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#475569', fontSize: 12, cursor: 'pointer' }}>✕</button>
              )}
            </div>

            {contacts.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <select onChange={e => e.target.value && fillFromContact(i, e.target.value)} defaultValue="" style={{ width: '100%', background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 5, color: '#94a3b8', fontSize: 11, padding: '6px 8px' }}>
                  <option value="">— Pick from contacts —</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>{c.contact.name}{c.contact.email ? ` (${c.contact.email})` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <input value={signer.name} onChange={e => updateSigner(i, 'name', e.target.value)} placeholder="Full name" style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 5, color: '#e2e8f0', fontSize: 11, padding: '6px 8px' }} />
              <input value={signer.email} onChange={e => updateSigner(i, 'email', e.target.value)} placeholder="Email" type="email" style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 5, color: '#e2e8f0', fontSize: 11, padding: '6px 8px' }} />
            </div>
            <select value={signer.role} onChange={e => updateSigner(i, 'role', e.target.value)} style={{ width: '100%', background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 5, color: '#94a3b8', fontSize: 11, padding: '6px 8px' }}>
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ))}

        {signers.length < 4 && (
          <button onClick={() => setSigners(prev => [...prev, { name: '', email: '', role: 'other' }])} style={{ width: '100%', padding: '7px', borderRadius: 5, border: '1px dashed #1a3050', background: 'none', color: '#4a6a9a', fontSize: 11, cursor: 'pointer', marginBottom: 12 }}>
            + Add Another Signer
          </button>
        )}

        <div style={{ background: '#060e1a', border: '1px solid #1a3050', borderRadius: 6, padding: '8px 12px', fontSize: 10, color: '#4a6a9a', marginBottom: 14 }}>
          After creating the session, you&apos;ll be taken to the signature builder to place fields, then send signing links to each signer.
        </div>

        {error && <div style={{ color: '#ef4444', fontSize: 11, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 5, border: '1px solid #1a3050', background: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={loading || !pdfPath} style={{ padding: '7px 16px', borderRadius: 5, border: 'none', background: pdfPath ? '#C9A84C' : '#374151', color: pdfPath ? '#060e1a' : '#6b7280', fontSize: 12, fontWeight: 700, cursor: pdfPath ? 'pointer' : 'not-allowed' }}>
            {loading ? 'Creating…' : 'Create Signing Session →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Document card ────────────────────────────────────────────────────────────

interface DocCardProps {
  doc:          WorkspaceDocument
  signingInfo?: { total: number; signed: number; sessionId: string | null; sessionStatus: string }
  onSendForSig: (doc: WorkspaceDocument) => void
  onRefresh:    () => void
}

function DocCard({ doc, signingInfo, onSendForSig, onRefresh }: DocCardProps) {
  const [deleting, setDeleting] = useState(false)

  const hasFile   = !!(doc.pdf_path || doc.signed_pdf_path || doc.file_path)
  const isSigned  = ['fully_signed', 'executed', 'accepted'].includes(doc.status)
  const isVoided  = ['voided', 'cancelled', 'rejected'].includes(doc.status)
  const canSign   = hasFile && !isSigned && !isVoided && !['pending_signature','partially_signed'].includes(doc.status)
  const isSigningActive = ['pending_signature','partially_signed'].includes(doc.status)

  const openDoc = async () => {
    window.open(`/documents/${doc.id}`, '_blank')
  }

  const openSignSession = () => {
    if (doc.signing_session_id) {
      window.open(`/sign-sessions/${doc.signing_session_id}`, '_blank')
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this document? This cannot be undone.')) return
    setDeleting(true)
    await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
    setDeleting(false)
    onRefresh()
  }

  return (
    <div style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 7, padding: '10px 12px', marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        {/* Left: doc info */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#1a3050', color: '#4a6a9a', flexShrink: 0 }}>
              {fileExt(doc)}
            </span>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc.name}
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#4a6a9a', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span>{fmtDate(doc.created_at)}</span>
            {(doc.version ?? 1) > 1 && <span>v{doc.version}</span>}
            {doc.offer_amount && <span>· {fmtCurrency(doc.offer_amount)}</span>}
            {doc.recipient_name && <span>· {doc.recipient_name}</span>}
          </div>
        </div>

        {/* Right: status */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <StatusBadge status={doc.status} />
          {signingInfo && signingInfo.total > 0 && (
            <SigningPill p={signingInfo} />
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {hasFile && (
          <button onClick={openDoc} style={btnStyle}>
            View
          </button>
        )}
        {isSigningActive && doc.signing_session_id && (
          <button onClick={openSignSession} style={{ ...btnStyle, borderColor: '#f59e0b44', color: '#f59e0b' }}>
            ✍ Signing Session →
          </button>
        )}
        {canSign && (
          <button onClick={() => onSendForSig(doc)} style={{ ...btnStyle, background: '#C9A84C', border: 'none', color: '#060e1a', fontWeight: 700 }}>
            Send for Signature →
          </button>
        )}
        {doc.signed_pdf_path && (
          <button onClick={openDoc} style={{ ...btnStyle, borderColor: '#22c55e44', color: '#22c55e' }}>
            ↓ Signed PDF
          </button>
        )}
        {!isSigned && !isSigningActive && (
          <button onClick={handleDelete} disabled={deleting} style={{ marginLeft: 'auto', ...btnStyle, borderColor: 'transparent', color: '#475569' }}>
            {deleting ? '…' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding:      '4px 9px',
  borderRadius: 4,
  border:       '1px solid #1a3050',
  background:   '#0d1b2e',
  color:        '#94a3b8',
  fontSize:     10,
  cursor:       'pointer',
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function WorkspaceDocsTab() {
  const { lead, documents, contacts, setActiveTab, refreshDocuments } = useWorkspace()
  const propertyId = lead.id

  const [showUpload,    setShowUpload]    = useState(false)
  const [showGenerate,  setShowGenerate]  = useState(false)
  const [signingFor,    setSigningFor]    = useState<WorkspaceDocument | null>(null)
  const [signingMap,    setSigningMap]    = useState<Record<string, { total: number; signed: number; sessionId: string | null; sessionStatus: string }>>({})
  const [loadingSig,    setLoadingSig]    = useState(false)

  // Fetch signing session summaries for all documents that have sessions
  const fetchSigningStatus = useCallback(async () => {
    const ids = documents
      .filter(d => d.signing_session_id)
      .map(d => d.signing_session_id as string)

    if (!ids.length) return
    setLoadingSig(true)
    try {
      const res = await fetch(`/api/signing-sessions?document_ids=${ids.join(',')}`)
      if (!res.ok) return
      const sessions: { id: string; status: string; signer_statuses: { status: string }[] }[] = await res.json()
      const newMap: typeof signingMap = {}
      for (const s of sessions) {
        const total  = s.signer_statuses?.length ?? 0
        const signed = s.signer_statuses?.filter(ss => ss.status === 'signed').length ?? 0
        newMap[s.id] = { total, signed, sessionId: s.id, sessionStatus: s.status }
      }
      setSigningMap(newMap)
    } catch {
      // non-fatal
    } finally {
      setLoadingSig(false)
    }
  }, [documents])

  useEffect(() => { fetchSigningStatus() }, [fetchSigningStatus])

  const handleUploaded = async () => {
    setShowUpload(false)
    await refreshDocuments()
  }

  const handleSigningCreated = async (sessionId: string) => {
    setSigningFor(null)
    await refreshDocuments()
    // Navigate to the session so user can add field placements and send
    window.open(`/sign-sessions/${sessionId}`, '_blank')
  }

  // Group documents by category
  const groups = groupDocuments(documents as unknown as DocumentRecord[])

  // Build per-document signing info
  const sigInfoFor = (doc: WorkspaceDocument) => {
    if (!doc.signing_session_id) return undefined
    return signingMap[doc.signing_session_id]
  }

  const totalDocs = documents.length

  return (
    <div>
      {/* ── Action bar ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => setShowGenerate(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 5, background: '#C9A84C', border: 'none', color: '#060e1a', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          ✦ Generate Contract
        </button>
        <button
          onClick={() => setShowUpload(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 5, border: '1px solid #1a3050', background: '#0d1b2e', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}
        >
          ↑ Upload Document
        </button>
        <a
          href="/documents/templates"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 5, border: '1px solid #1a3050', background: '#0d1b2e', color: '#94a3b8', fontSize: 11, cursor: 'pointer', textDecoration: 'none' }}
        >
          ☰ Templates
        </a>
        {totalDocs > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#4a6a9a' }}>{totalDocs} document{totalDocs !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* ── Document groups ───────────────────────────────────────────────── */}
      {groups.length === 0 ? (
        <div style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 7, padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>No documents yet.</div>
          <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 16 }}>Generate a contract from a template or upload a file to get started.</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => setShowGenerate(true)} style={{ padding: '6px 14px', borderRadius: 5, background: '#C9A84C', border: 'none', color: '#060e1a', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              ✦ Generate Contract
            </button>
            <button onClick={() => setShowUpload(true)} style={{ padding: '6px 14px', borderRadius: 5, border: '1px solid #1a3050', background: 'none', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
              ↑ Upload
            </button>
          </div>
        </div>
      ) : (
        groups.map(group => (
          <div key={group.label} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#4a6a9a' }}>{group.label}</div>
              <div style={{ flex: 1, height: 1, background: '#1a3050' }} />
              <div style={{ fontSize: 10, color: '#4a6a9a' }}>{group.docs.length}</div>
            </div>
            {group.docs.map(doc => (
              <DocCard
                key={doc.id}
                doc={doc as unknown as WorkspaceDocument}
                signingInfo={sigInfoFor(doc as unknown as WorkspaceDocument)}
                onSendForSig={setSigningFor}
                onRefresh={refreshDocuments}
              />
            ))}
          </div>
        ))
      )}

      {/* ── All docs link ─────────────────────────────────────────────────── */}
      {totalDocs > 0 && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <a
            href={`/documents?property_id=${propertyId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 11, color: '#4a6a9a', textDecoration: 'none' }}
          >
            View all documents in Document Repository →
          </a>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {showUpload && (
        <UploadModal propertyId={propertyId} onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />
      )}

      {signingFor && (
        <SignatureRequestModal
          doc={signingFor}
          propertyId={propertyId}
          contacts={contacts}
          onClose={() => setSigningFor(null)}
          onRequested={handleSigningCreated}
        />
      )}

      {showGenerate && (
        <GenerateContractModal
          onClose={() => { setShowGenerate(false); refreshDocuments() }}
          defaultPropertyId={propertyId}
          defaultLeadId={propertyId}
        />
      )}
    </div>
  )
}
