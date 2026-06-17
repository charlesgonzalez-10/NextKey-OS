'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

const DocumentViewer = dynamic(() => import('@/components/DocumentViewer'), { ssr: false })

interface Doc {
  id: string
  name: string
  category: string
  status: string
  file_type: string | null
  file_path: string | null
  pdf_path: string | null
  signed_pdf_path: string | null
  created_at: string
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft:        { bg: 'rgba(255,255,255,0.08)', text: 'rgba(255,255,255,0.45)' },
  generated:    { bg: 'rgba(99,102,241,0.15)',  text: '#818cf8' },
  signed_by_me: { bg: 'rgba(201,168,76,0.15)',  text: '#C9A84C' },
  sent:         { bg: 'rgba(56,189,248,0.15)',   text: '#38bdf8' },
  fully_signed: { bg: 'rgba(74,207,154,0.15)',   text: '#4ACF9A' },
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', generated: 'Generated', signed_by_me: 'Signed',
  sent: 'Sent', fully_signed: 'Fully Signed', expired: 'Expired',
}
const CATEGORY_LABEL: Record<string, string> = {
  offer: 'Offer', loi: 'LOI', assignment: 'Assignment', contract: 'Contract',
  disclosure: 'Disclosure', letter: 'Letter', photo: 'Photo',
  closing: 'Closing', probate: 'Probate', foreclosure: 'Foreclosure',
  title: 'Title', seller: 'Seller', buyer: 'Buyer', marketing: 'Marketing', other: 'Other',
}
const FILE_ICONS: Record<string, string> = {
  pdf: '📄', docx: '📝', xlsx: '📊', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', txt: '📃',
}

interface DocumentsTabProps {
  propertyId?: string
  leadId?: string
  contactId?: string
  dealId?: string
}

export default function DocumentsTab({ propertyId, leadId, contactId, dealId }: DocumentsTabProps) {
  const router = useRouter()
  const [docs, setDocs]         = useState<Doc[]>([])
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [viewer, setViewer]     = useState<{ url: string; name: string; fileType: string | null } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const query = new URLSearchParams()
  if (propertyId) query.set('property_id', propertyId)
  if (leadId)     query.set('lead_id', leadId)
  if (contactId)  query.set('contact_id', contactId)
  if (dealId)     query.set('deal_id', dealId)

  const templateLink = `/documents/new?${query}`

  const load = useCallback(() => {
    fetch(`/api/documents?${query}`)
      .then(r => r.json())
      .then(d => setDocs(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [query.toString()]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const uploadFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    if (!fileArr.length) return
    setUploading(true)
    setUploadMsg('Uploading…')
    const fd = new FormData()
    fileArr.forEach(f => fd.append('files', f))
    if (propertyId) fd.append('property_id', propertyId)
    if (leadId)     fd.append('lead_id', leadId)
    if (contactId)  fd.append('contact_id', contactId)
    if (dealId)     fd.append('deal_id', dealId)
    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd })
      const d   = await res.json()
      if (d.documents?.length) setDocs(prev => [...d.documents, ...prev])
      setUploadMsg(`${d.documents?.length ?? 0} uploaded`)
      setTimeout(() => setUploadMsg(''), 3000)
    } catch { setUploadMsg('Upload failed') }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const openViewer = async (doc: Doc) => {
    const res = await fetch(`/api/documents/${doc.id}/url`)
    const d   = await res.json()
    if (d.url) setViewer({ url: d.url, name: doc.name, fileType: doc.file_type })
  }

  const deleteDoc = async (id: string) => {
    if (!confirm('Delete this document?')) return
    await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    setDocs(prev => prev.filter(d => d.id !== id))
  }

  const hasFile = (doc: Doc) => !!(doc.signed_pdf_path || doc.pdf_path || doc.file_path)
  const isPdf   = (doc: Doc) => doc.file_type === 'pdf' || !!(doc.pdf_path || doc.signed_pdf_path)

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid #C9A84C', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-primary)', margin: 0 }}>Documents</h2>
          <p style={{ fontSize: 12, color: 'var(--c-text-3)', margin: '2px 0 0' }}>Contracts, photos, and deal files</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {uploadMsg && <span style={{ fontSize: 11, color: uploading ? '#C9A84C' : 'var(--c-text-3)' }}>{uploadMsg}</span>}
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            style={{ fontSize: 12, padding: '6px 14px', borderRadius: 7, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer', fontWeight: 500 }}>
            {uploading ? 'Uploading…' : '⬆ Upload'}
          </button>
          <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.doc,.xlsx,.xls,.jpg,.jpeg,.png,.txt"
            style={{ display: 'none' }} onChange={e => { if (e.target.files) uploadFiles(e.target.files) }} />
          <a href={templateLink}
            style={{ fontSize: 12, padding: '6px 14px', borderRadius: 7, backgroundColor: '#C9A84C', color: '#0A1F44', textDecoration: 'none', fontWeight: 700 }}>
            + From Template
          </a>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files) }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `1.5px dashed ${dragOver ? '#C9A84C' : 'var(--c-border)'}`,
          borderRadius: 10, padding: '12px 16px', marginBottom: 16,
          cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
          backgroundColor: dragOver ? 'rgba(201,168,76,0.05)' : 'transparent',
          fontSize: 12, color: dragOver ? '#C9A84C' : 'var(--c-text-3)',
        }}
      >
        {dragOver ? 'Drop to upload' : 'Drag & drop files here, or click to browse'}
      </div>

      {docs.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', border: '1px dashed var(--c-border)', borderRadius: 10 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-2)', marginBottom: 6 }}>No documents yet</p>
          <p style={{ fontSize: 12, color: 'var(--c-text-3)' }}>Upload a file or create from a template above.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docs.map(doc => {
            const sc = STATUS_COLORS[doc.status] ?? STATUS_COLORS.draft
            return (
              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 10 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{FILE_ICONS[doc.file_type ?? ''] ?? '📄'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{doc.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, backgroundColor: sc.bg, color: sc.text }}>
                      {STATUS_LABEL[doc.status] ?? doc.status}
                    </span>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-3)' }}>
                      {CATEGORY_LABEL[doc.category] ?? doc.category}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
                    {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {hasFile(doc) && (
                    <button onClick={() => openViewer(doc)}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(201,168,76,0.3)', backgroundColor: 'rgba(201,168,76,0.07)', color: '#C9A84C', cursor: 'pointer' }}>
                      View
                    </button>
                  )}
                  {isPdf(doc) && hasFile(doc) && (
                    <button onClick={() => router.push(`/documents/${doc.id}/fill`)}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none', backgroundColor: '#C9A84C', color: '#0A1F44', cursor: 'pointer', fontWeight: 700 }}>
                      Fill
                    </button>
                  )}
                  <button onClick={() => deleteDoc(doc.id)}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.06)', color: '#ef4444', cursor: 'pointer' }}>
                    ×
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {viewer && <DocumentViewer url={viewer.url} name={viewer.name} fileType={viewer.fileType} onClose={() => setViewer(null)} />}
    </div>
  )
}
