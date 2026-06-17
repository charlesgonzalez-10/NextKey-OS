'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

const DocumentViewer      = dynamic(() => import('@/components/DocumentViewer'), { ssr: false })
const GenerateContractModal = dynamic(() => import('@/components/GenerateContractModal'), { ssr: false })

interface Doc {
  id: string
  name: string
  category: string
  status: string
  file_type: string | null
  file_path: string | null
  offer_amount: number | null
  recipient_name: string | null
  sent_at: string | null
  expires_at: string | null
  pdf_path: string | null
  signed_pdf_path: string | null
  created_at: string
  lead_id: string | null
  deal_id: string | null
  property_id: string | null
  contact_id: string | null
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft:         { bg: 'rgba(255,255,255,0.08)', text: 'rgba(255,255,255,0.45)' },
  generated:     { bg: 'rgba(99,102,241,0.15)',  text: '#818cf8' },
  signed_by_me:  { bg: 'rgba(201,168,76,0.15)',  text: '#C9A84C' },
  sent:          { bg: 'rgba(56,189,248,0.15)',   text: '#38bdf8' },
  fully_signed:  { bg: 'rgba(74,207,154,0.15)',   text: '#4ACF9A' },
  expired:       { bg: 'rgba(239,68,68,0.1)',     text: '#ef4444' },
  cancelled:     { bg: 'rgba(255,255,255,0.05)',  text: 'rgba(255,255,255,0.3)' },
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', generated: 'Generated', signed_by_me: 'Signed',
  sent: 'Sent', fully_signed: 'Fully Signed', expired: 'Expired', cancelled: 'Cancelled',
}
const CATEGORY_LABEL: Record<string, string> = {
  offer: 'Offer', loi: 'LOI', assignment: 'Assignment', contract: 'Contract',
  disclosure: 'Disclosure', letter: 'Letter', photo: 'Photo',
  closing: 'Closing', probate: 'Probate', foreclosure: 'Foreclosure',
  title: 'Title', seller: 'Seller', buyer: 'Buyer', marketing: 'Marketing', other: 'Other',
}
const FILE_ICONS: Record<string, string> = {
  pdf: '📄', docx: '📝', doc: '📝', xlsx: '📊', xls: '📊',
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', txt: '📃',
}

function fileIcon(doc: Doc) {
  if (doc.file_type) return FILE_ICONS[doc.file_type] ?? '📄'
  if (doc.pdf_path || doc.signed_pdf_path) return '📄'
  return '📄'
}

function hasViewableFile(doc: Doc) {
  return !!(doc.signed_pdf_path || doc.pdf_path || doc.file_path)
}

function isPdf(doc: Doc) {
  return doc.file_type === 'pdf' || !!(doc.pdf_path || doc.signed_pdf_path)
}

const CATEGORY_FILTERS = [
  '', 'offer', 'loi', 'assignment', 'contract', 'disclosure', 'letter',
  'closing', 'probate', 'foreclosure', 'title', 'seller', 'buyer', 'photo', 'other',
]

export default function DocumentsClient() {
  const router = useRouter()
  const [docs, setDocs]               = useState<Doc[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [catFilter, setCatFilter]     = useState('')
  const [uploading, setUploading]     = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [dragOver, setDragOver]       = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [deleting, setDeleting]       = useState<string | null>(null)
  const [viewer, setViewer]           = useState<{ url: string; name: string; fileType: string | null } | null>(null)
  const [showGenModal, setShowGenModal] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter)     params.set('status', statusFilter)
    if (catFilter)        params.set('category', catFilter)
    if (debouncedSearch)  params.set('q', debouncedSearch)
    fetch(`/api/documents?${params}`)
      .then(r => r.json())
      .then(d => setDocs(Array.isArray(d) ? d : []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false))
  }, [statusFilter, catFilter, debouncedSearch])

  useEffect(() => { load() }, [load])

  const uploadFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    if (!fileArr.length) return
    setUploading(true)
    setUploadProgress(`Uploading ${fileArr.length} file${fileArr.length > 1 ? 's' : ''}…`)
    const fd = new FormData()
    fileArr.forEach(f => fd.append('files', f))
    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const d   = await res.json()
      if (d.documents?.length) {
        setDocs(prev => [...d.documents, ...prev])
        setUploadProgress(`Uploaded ${d.documents.length} file${d.documents.length > 1 ? 's' : ''}`)
      }
      if (d.errors?.length) setUploadProgress(`${d.documents?.length ?? 0} uploaded, ${d.errors.length} failed`)
      setTimeout(() => setUploadProgress(''), 3000)
    } catch {
      setUploadProgress('Upload failed')
    }
    setUploading(false)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    uploadFiles(e.dataTransfer.files)
  }

  const openViewer = async (doc: Doc) => {
    const res = await fetch(`/api/documents/${doc.id}/url`)
    const d   = await res.json()
    if (d.url) setViewer({ url: d.url, name: doc.name, fileType: doc.file_type })
  }

  const download = async (doc: Doc) => {
    setDownloading(doc.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}/url`)
      const { url } = await res.json()
      if (url) { const a = document.createElement('a'); a.href = url; a.download = doc.name; a.click() }
    } finally { setDownloading(null) }
  }

  const deleteDoc = async (id: string) => {
    if (!confirm('Delete this document?')) return
    setDeleting(id)
    await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    setDocs(prev => prev.filter(d => d.id !== id))
    setDeleting(null)
  }

  return (
    <div style={{ color: 'var(--c-primary)', maxWidth: 1040, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Documents</h1>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Contracts, offers, photos, and all deal files</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {uploadProgress && <span style={{ fontSize: 12, color: uploading ? '#C9A84C' : 'var(--c-text-2)' }}>{uploadProgress}</span>}
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--c-text-2)', border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : '⬆ Upload Files'}
          </button>
          <input ref={fileInputRef} type="file" multiple
            accept=".pdf,.docx,.doc,.xlsx,.xls,.jpg,.jpeg,.png,.txt"
            style={{ display: 'none' }} onChange={e => { if (e.target.files) uploadFiles(e.target.files) }} />
          <a href="/documents/templates" style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'var(--c-text-2)', textDecoration: 'none', border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)' }}>
            Templates
          </a>
          <button
            onClick={() => setShowGenModal(true)}
            style={{ padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}>
            Generate Contract
          </button>
          <a href="/documents/new" style={{ padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)', textDecoration: 'none', border: '1px solid var(--c-border)' }}>
            + New Document
          </a>
        </div>
      </div>

      {/* Drag & Drop Upload Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#C9A84C' : 'var(--c-border)'}`,
          borderRadius: 12, padding: '18px 24px', marginBottom: 24,
          backgroundColor: dragOver ? 'rgba(201,168,76,0.05)' : 'transparent',
          cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}
      >
        <span style={{ fontSize: 20 }}>⬆</span>
        <span style={{ fontSize: 13, color: dragOver ? '#C9A84C' : 'var(--c-text-3)', fontWeight: 500 }}>
          {dragOver ? 'Drop to upload' : 'Drag & drop files here — PDF, DOCX, XLSX, JPG, PNG, TXT'}
        </span>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search by document name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '9px 14px', borderRadius: 8, fontSize: 13,
            backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
            color: 'var(--c-primary)', outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {['', 'draft', 'generated', 'signed_by_me', 'sent', 'fully_signed', 'expired'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
            backgroundColor: statusFilter === s ? '#C9A84C' : 'var(--c-hover)',
            color: statusFilter === s ? '#0A1F44' : 'var(--c-text-2)',
          }}>
            {s ? STATUS_LABEL[s] : 'All Status'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {CATEGORY_FILTERS.map(c => (
          <button key={c} onClick={() => setCatFilter(c)} style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
            backgroundColor: catFilter === c ? 'rgba(201,168,76,0.85)' : 'var(--c-hover)',
            color: catFilter === c ? '#0A1F44' : 'var(--c-text-2)',
          }}>
            {c ? CATEGORY_LABEL[c] ?? c : 'All Categories'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--c-text-2)', fontSize: 14 }}>Loading…</div>
      ) : docs.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 16 }}>
          {(search || statusFilter || catFilter) ? (
            <>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>No documents match your filters</p>
              <button onClick={() => { setSearch(''); setStatusFilter(''); setCatFilter('') }}
                style={{ padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)', border: '1px solid var(--c-border)', cursor: 'pointer' }}>
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>No documents yet</p>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 20 }}>Upload files or create from a template</p>
              <a href="/documents/new" style={{ padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', textDecoration: 'none' }}>
                Create Document
              </a>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map(doc => {
            const sc = STATUS_COLORS[doc.status] ?? STATUS_COLORS.draft
            const canView = hasViewableFile(doc)
            const canFill = isPdf(doc) && canView
            return (
              <div key={doc.id} style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                {/* Icon */}
                <div style={{ fontSize: 22, flexShrink: 0, width: 36, textAlign: 'center' }}>{fileIcon(doc)}</div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => router.push(`/documents/${doc.id}`)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{doc.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5, backgroundColor: sc.bg, color: sc.text }}>
                      {STATUS_LABEL[doc.status] ?? doc.status}
                    </span>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>
                      {CATEGORY_LABEL[doc.category] ?? doc.category}
                    </span>
                    {doc.file_type && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-3)', textTransform: 'uppercase' }}>{doc.file_type}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--c-text-2)' }}>
                    {doc.offer_amount && <span>${Number(doc.offer_amount).toLocaleString()}</span>}
                    {doc.recipient_name && <span>→ {doc.recipient_name}</span>}
                    <span>{new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {canView && (
                    <button onClick={() => openViewer(doc)}
                      style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500, backgroundColor: 'rgba(201,168,76,0.1)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)', cursor: 'pointer' }}>
                      View
                    </button>
                  )}
                  {canFill && (
                    <button onClick={() => router.push(`/documents/${doc.id}/fill`)}
                      style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}>
                      Fill & Sign
                    </button>
                  )}
                  <button onClick={() => download(doc)} disabled={downloading === doc.id}
                    style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500, backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)', border: '1px solid var(--c-border)', cursor: 'pointer', opacity: downloading === doc.id ? 0.5 : 1 }}>
                    {downloading === doc.id ? '…' : 'Download'}
                  </button>
                  <button onClick={() => deleteDoc(doc.id)} disabled={deleting === doc.id}
                    style={{ padding: '6px 10px', borderRadius: 7, fontSize: 12, backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer', opacity: deleting === doc.id ? 0.5 : 1 }}>
                    {deleting === doc.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {viewer && (
        <DocumentViewer
          url={viewer.url}
          name={viewer.name}
          fileType={viewer.fileType}
          onClose={() => setViewer(null)}
        />
      )}

      {showGenModal && (
        <GenerateContractModal
          onClose={() => { setShowGenModal(false); load() }}
        />
      )}
    </div>
  )
}
