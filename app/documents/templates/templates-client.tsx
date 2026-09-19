'use client'

import { useState, useEffect, useRef } from 'react'

// ── Contract templates (contract_templates — PDF uploads) ─────────────────────

interface ContractTemplate {
  id: string
  name: string
  description: string | null
  category: string
  file_path: string
  page_count: number | null
  current_version_id: string | null
  draft_field_count: number
  created_at: string
}

// ── Generation modal types ────────────────────────────────────────────────────

interface SearchContact { id: string; name: string; email: string | null; phone: string | null }
interface SearchProperty { id: string; property_address: string; owner_name: string | null; city: string | null }
interface SearchDeal { id: string; address: string; offer_price: number | null; status: string }

const CATEGORIES = ['offer', 'loi', 'assignment', 'contract', 'disclosure', 'letter', 'other']
const CATEGORY_LABEL: Record<string, string> = {
  offer: 'Offer', loi: 'LOI', assignment: 'Assignment', contract: 'Contract',
  disclosure: 'Disclosure', letter: 'Letter', other: 'Other',
}

export default function TemplatesClient() {
  // ── Contract template state ────────────────────────────────────────────────
  const [contracts, setContracts]             = useState<ContractTemplate[]>([])
  const [loadingContracts, setLoadingContracts] = useState(true)
  const [uploadingContract, setUploadingContract] = useState(false)
  const [uploadBanner, setUploadBanner]       = useState<string | null>(null)
  const [deletingContract, setDeletingContract] = useState<string | null>(null)
  const contractFileRef = useRef<HTMLInputElement>(null)

  // ── Generation modal state ─────────────────────────────────────────────────
  const [genTemplate, setGenTemplate]     = useState<ContractTemplate | null>(null)
  const [genContactQ, setGenContactQ]     = useState('')
  const [genContacts, setGenContacts]     = useState<SearchContact[]>([])
  const [genContactId, setGenContactId]   = useState<string | null>(null)
  const [genContactName, setGenContactName] = useState('')
  const [genPropertyQ, setGenPropertyQ]   = useState('')
  const [genProperties, setGenProperties] = useState<SearchProperty[]>([])
  const [genLeadId, setGenLeadId]         = useState<string | null>(null)
  const [genPropertyName, setGenPropertyName] = useState('')
  const [genDealQ, setGenDealQ]           = useState('')
  const [genDeals, setGenDeals]           = useState<SearchDeal[]>([])
  const [genDealId, setGenDealId]         = useState<string | null>(null)
  const [genDealName, setGenDealName]     = useState('')
  const [generating, setGenerating]       = useState(false)
  const [genError, setGenError]           = useState<string | null>(null)

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadContracts = () => {
    setLoadingContracts(true)
    fetch('/api/contract-templates')
      .then(r => r.json())
      .then(d => setContracts(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoadingContracts(false))
  }

  useEffect(() => { loadContracts() }, [])

  // ── Contract template actions ──────────────────────────────────────────────

  const uploadContract = async (files: FileList | null) => {
    if (!files?.length) return
    const file = files[0]
    if (file.type !== 'application/pdf') { setUploadBanner('Only PDF files accepted.'); return }
    setUploadingContract(true); setUploadBanner('Uploading…')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', file.name.replace(/\.pdf$/i, ''))
      fd.append('category', 'other')
      const res = await fetch('/api/contract-templates/upload', { method: 'POST', body: fd })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Upload failed')
      setContracts(prev => [d, ...prev])
      setUploadBanner('Uploaded. Open builder to add fields.')
    } catch (e) {
      setUploadBanner(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploadingContract(false)
      setTimeout(() => setUploadBanner(null), 4000)
    }
  }

  const deleteContract = async (id: string) => {
    if (!confirm('Delete this contract template?')) return
    setDeletingContract(id)
    await fetch(`/api/contract-templates/${id}`, { method: 'DELETE' })
    setContracts(prev => prev.filter(c => c.id !== id))
    setDeletingContract(null)
  }

  // ── Generation modal ───────────────────────────────────────────────────────

  const openGenModal = (c: ContractTemplate) => {
    setGenTemplate(c)
    setGenContactQ(''); setGenContacts([]); setGenContactId(null); setGenContactName('')
    setGenPropertyQ(''); setGenProperties([]); setGenLeadId(null); setGenPropertyName('')
    setGenDealQ(''); setGenDeals([]); setGenDealId(null); setGenDealName('')
    setGenError(null)
  }

  const searchContacts = async (q: string) => {
    setGenContactQ(q)
    if (q.length < 2) { setGenContacts([]); return }
    const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(q)}&limit=8`)
    const d = await res.json()
    setGenContacts(Array.isArray(d.contacts) ? d.contacts : [])
  }

  const searchProperties = async (q: string) => {
    setGenPropertyQ(q)
    if (q.length < 2) { setGenProperties([]); return }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
    const d = await res.json()
    setGenProperties(Array.isArray(d.properties) ? d.properties : [])
  }

  const searchDeals = async (q: string) => {
    setGenDealQ(q)
    if (q.length < 2) { setGenDeals([]); return }
    const res = await fetch(`/api/deals?q=${encodeURIComponent(q)}&limit=8`)
    const d = await res.json()
    setGenDeals(Array.isArray(d.deals) ? d.deals : [])
  }

  const generatePdf = async () => {
    if (!genTemplate) return
    setGenerating(true); setGenError(null)
    try {
      const res = await fetch(`/api/contract-templates/${genTemplate.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: genContactId, lead_id: genLeadId, deal_id: genDealId }),
      })
      if (!res.ok) {
        const d = await res.json()
        setGenError(d.error ?? 'Generation failed.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${genTemplate.name} - Filled.pdf`
      document.body.appendChild(a); a.click()
      document.body.removeChild(a); URL.revokeObjectURL(url)
      setGenTemplate(null)
    } catch {
      setGenError('Generation failed. Try again.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{ color: 'var(--c-primary)', maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, gap: 16 }}>
        <div>
          <a href="/documents" style={{ fontSize: 13, color: 'var(--c-text-2)', textDecoration: 'none' }}>← Documents</a>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>Templates</h1>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — CONTRACT LIBRARY (PDF uploads with field mapping)
      ══════════════════════════════════════════════════════════════════════ */}

      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Contract Library</h2>
            <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
              Upload PDFs and map fields to auto-fill variables — then Generate or Use for signing
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {uploadBanner && (
              <span style={{ fontSize: 12, color: uploadingContract ? '#C9A84C' : '#4ACF9A' }}>{uploadBanner}</span>
            )}
            <input
              ref={contractFileRef}
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={e => uploadContract(e.target.files)}
            />
            <a
              href="/documents/templates/builder"
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                backgroundColor: '#C9A84C', color: '#0A1F44',
                border: 'none', textDecoration: 'none', display: 'inline-block',
              }}
            >
              + Build Template
            </a>
            <button
              onClick={() => contractFileRef.current?.click()}
              disabled={uploadingContract}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)',
                border: '1px solid var(--c-border)', cursor: uploadingContract ? 'wait' : 'pointer',
                opacity: uploadingContract ? 0.6 : 1,
              }}
            >
              {uploadingContract ? 'Uploading…' : '⬆ Upload PDF'}
            </button>
          </div>
        </div>

        {loadingContracts ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--c-text-2)', fontSize: 13 }}>Loading…</div>
        ) : contracts.length === 0 ? (
          <div
            onClick={() => contractFileRef.current?.click()}
            style={{
              padding: '28px 24px', borderRadius: 14, textAlign: 'center', cursor: 'pointer',
              border: '2px dashed var(--c-border)', backgroundColor: 'transparent',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#C9A84C')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--c-border)')}
          >
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No PDF contracts uploaded yet</p>
            <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
              Upload a contract PDF, then use the builder to map fields for auto-fill
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contracts.map(c => {
              const hasMappings = c.draft_field_count > 0 || !!c.current_version_id
              return (
                <div
                  key={c.id}
                  style={{
                    backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
                    borderRadius: 14, padding: '14px 18px',
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}
                >
                  {/* PDF icon */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    backgroundColor: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18,
                  }}>
                    📄
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                        backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C',
                      }}>
                        {CATEGORY_LABEL[c.category] ?? c.category}
                      </span>
                      {hasMappings && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                          backgroundColor: 'rgba(74,207,154,0.12)', color: '#4ACF9A',
                        }}>
                          {c.current_version_id ? 'Published' : `${c.draft_field_count} fields`}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--c-text-2)' }}>
                      {c.page_count ? `${c.page_count} page${c.page_count !== 1 ? 's' : ''}` : 'PDF'}
                      {' · '}
                      Uploaded {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {/* Generate — only if has field mappings */}
                    {hasMappings && (
                      <button
                        onClick={() => openGenModal(c)}
                        style={{
                          padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                          backgroundColor: 'rgba(74,207,154,0.1)', color: '#4ACF9A',
                          border: '1px solid rgba(74,207,154,0.25)', cursor: 'pointer',
                        }}
                      >
                        Generate
                      </button>
                    )}
                    {/* Build — opens field mapping builder */}
                    <a
                      href={`/documents/templates/builder?id=${c.id}`}
                      style={{
                        padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        backgroundColor: 'rgba(201,168,76,0.1)', color: '#C9A84C',
                        border: '1px solid rgba(201,168,76,0.25)', textDecoration: 'none',
                      }}
                    >
                      {hasMappings ? 'Edit Fields' : 'Build Fields'}
                    </a>
                    {/* Use → opens signing wizard */}
                    <a
                      href={`/sign-sessions/new?contract_template_id=${c.id}`}
                      style={{
                        padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                        backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)',
                        border: '1px solid var(--c-border)', textDecoration: 'none',
                      }}
                    >
                      Sign
                    </a>
                    <button
                      onClick={() => deleteContract(c.id)}
                      disabled={deletingContract === c.id}
                      style={{
                        padding: '7px 12px', borderRadius: 8, fontSize: 12,
                        backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444',
                        border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer',
                        opacity: deletingContract === c.id ? 0.5 : 1,
                      }}
                    >
                      {deletingContract === c.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>


      {/* ══════════════════════════════════════════════════════════════════════
          GENERATION MODAL
      ══════════════════════════════════════════════════════════════════════ */}

      {genTemplate && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}
          onClick={e => { if (e.target === e.currentTarget) setGenTemplate(null) }}
        >
          <div style={{
            backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
            borderRadius: 18, padding: 32, width: '100%', maxWidth: 520,
            maxHeight: '85vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700 }}>Generate Filled PDF</h2>
                <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginTop: 2 }}>{genTemplate.name}</p>
              </div>
              <button
                onClick={() => setGenTemplate(null)}
                style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-2)' }}
              >×</button>
            </div>

            <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginBottom: 20 }}>
              Select the entities to fill in mapped fields. All are optional — unmatched fields will be left blank.
            </p>

            {/* Contact search */}
            <GenPicker
              label="Contact (Buyer)"
              placeholder="Search by name or email…"
              query={genContactQ}
              onQuery={searchContacts}
              selectedName={genContactName}
              onClear={() => { setGenContactId(null); setGenContactName(''); setGenContactQ(''); setGenContacts([]) }}
              results={genContacts.map(c => ({
                id: c.id,
                primary: c.name,
                secondary: [c.email, c.phone].filter(Boolean).join(' · '),
              }))}
              onSelect={item => { setGenContactId(item.id); setGenContactName(item.primary); setGenContacts([]) }}
            />

            {/* Property search */}
            <GenPicker
              label="Property"
              placeholder="Search by address…"
              query={genPropertyQ}
              onQuery={searchProperties}
              selectedName={genPropertyName}
              onClear={() => { setGenLeadId(null); setGenPropertyName(''); setGenPropertyQ(''); setGenProperties([]) }}
              results={genProperties.map(p => ({
                id: p.id,
                primary: p.property_address,
                secondary: [p.city, p.owner_name].filter(Boolean).join(' · '),
              }))}
              onSelect={item => { setGenLeadId(item.id); setGenPropertyName(item.primary); setGenProperties([]) }}
            />

            {/* Deal search */}
            <GenPicker
              label="Deal"
              placeholder="Search by address…"
              query={genDealQ}
              onQuery={searchDeals}
              selectedName={genDealName}
              onClear={() => { setGenDealId(null); setGenDealName(''); setGenDealQ(''); setGenDeals([]) }}
              results={genDeals.map(d => ({
                id: d.id,
                primary: d.address,
                secondary: [d.status, d.offer_price ? `$${Number(d.offer_price).toLocaleString()}` : ''].filter(Boolean).join(' · '),
              }))}
              onSelect={item => { setGenDealId(item.id); setGenDealName(item.primary); setGenDeals([]) }}
            />

            {genError && (
              <p style={{ fontSize: 13, color: '#ef4444', marginBottom: 16 }}>{genError}</p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                onClick={generatePdf}
                disabled={generating}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 700,
                  backgroundColor: '#0A1F44', color: '#C9A84C', border: 'none',
                  cursor: generating ? 'wait' : 'pointer', opacity: generating ? 0.7 : 1,
                }}
              >
                {generating ? 'Generating…' : '⬇ Generate & Download PDF'}
              </button>
              <button
                onClick={() => setGenTemplate(null)}
                style={{
                  padding: '12px 18px', borderRadius: 10, fontSize: 14,
                  backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)',
                  border: '1px solid var(--c-border)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Reusable entity picker component ──────────────────────────────────────────

interface PickerResult { id: string; primary: string; secondary: string }

function GenPicker({
  label, placeholder, query, onQuery,
  selectedName, onClear, results, onSelect,
}: {
  label: string
  placeholder: string
  query: string
  onQuery: (q: string) => void
  selectedName: string
  onClear: () => void
  results: PickerResult[]
  onSelect: (item: PickerResult) => void
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 6, color: 'var(--c-text-2)' }}>{label}</label>
      {selectedName ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
          borderRadius: 8, border: '1px solid rgba(74,207,154,0.4)',
          backgroundColor: 'rgba(74,207,154,0.06)',
        }}>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--c-primary)', fontWeight: 600 }}>{selectedName}</span>
          <button
            onClick={onClear}
            style={{ fontSize: 12, color: 'var(--c-text-2)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ✕ Clear
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input
            value={query}
            onChange={e => onQuery(e.target.value)}
            placeholder={placeholder}
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
              border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)',
              color: 'var(--c-primary)', boxSizing: 'border-box',
            }}
          />
          {results.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
              borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', marginTop: 4,
              maxHeight: 200, overflowY: 'auto',
            }}>
              {results.map(item => (
                <button
                  key={item.id}
                  onClick={() => onSelect(item)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '10px 14px', fontSize: 13, border: 'none',
                    backgroundColor: 'transparent', color: 'var(--c-primary)', cursor: 'pointer',
                    borderBottom: '1px solid var(--c-border)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <span style={{ fontWeight: 600 }}>{item.primary}</span>
                  {item.secondary && <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text-2)', marginTop: 1 }}>{item.secondary}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
