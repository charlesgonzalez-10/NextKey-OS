'use client'

import { useState, useEffect, useRef } from 'react'

interface ContractTemplate {
  id: string; name: string; category: string; page_count: number | null; created_at: string
}

type Theme    = 'auto' | 'light' | 'dark'
type LandingPage = '/' | '/leads' | '/contacts' | '/inbox' | '/pipeline' | '/property-search'
type RowsPer = 25 | 50 | 100

const S = {
  card: { backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '20px 24px', marginBottom: 12 } as React.CSSProperties,
  sectionLabel: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 14 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 } as React.CSSProperties,
  optionGroup: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  saveBtn: { padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' } as React.CSSProperties,
}

function OptionButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      border: `1.5px solid ${active ? '#C9A84C' : 'var(--c-border)'}`,
      backgroundColor: active ? 'rgba(201,168,76,0.12)' : 'var(--c-hover)',
      color: active ? '#C9A84C' : 'var(--c-text-2)',
    }}>{label}</button>
  )
}

function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: () => void; label: string; desc?: string }) {
  return (
    <div style={{ ...S.row, marginBottom: 16 }}>
      <div>
        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: desc ? 2 : 0 }}>{label}</p>
        {desc && <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>{desc}</p>}
      </div>
      <button onClick={onChange} style={{ position: 'relative', width: 46, height: 25, borderRadius: 13, backgroundColor: checked ? '#C9A84C' : 'var(--c-hover)', border: '1px solid var(--c-border)', cursor: 'pointer', transition: 'background-color 0.2s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, left: checked ? 22 : 3, width: 17, height: 17, borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
      </button>
    </div>
  )
}

function ContractLibrary() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/contract-templates')
      .then(r => r.json())
      .then(d => { setTemplates(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const upload = async (file: File) => {
    if (file.type !== 'application/pdf') { setUploadError('Only PDF files are supported.'); return }
    setUploading(true); setUploadError('')
    try {
      // Step 1: Get page count client-side
      let pageCount: number | null = null
      try {
        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const buf = await file.arrayBuffer()
        const doc = await pdfjsLib.getDocument({ data: buf }).promise
        pageCount = doc.numPages
      } catch { /* non-critical */ }

      // Step 2: Get presigned upload URL from server
      const urlRes = await fetch(`/api/contract-templates/upload-url?filename=${encodeURIComponent(file.name)}`)
      if (!urlRes.ok) {
        const e = await urlRes.json().catch(() => ({}))
        throw new Error(e.error ?? 'Could not get upload URL')
      }
      const { signedUrl, path } = await urlRes.json()

      // Step 3: Upload directly to Supabase storage (bypasses Vercel payload limit)
      const putRes = await fetch(signedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': 'application/pdf' },
      })
      if (!putRes.ok) throw new Error(`Storage upload failed (${putRes.status})`)

      // Step 4: Register in DB
      const name = file.name.replace(/\.pdf$/i, '')
      const regRes = await fetch('/api/contract-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, name, page_count: pageCount }),
      })
      if (!regRes.ok) {
        const e = await regRes.json().catch(() => ({}))
        throw new Error(e.error ?? 'Failed to save template')
      }
      const template = await regRes.json()
      setTemplates(prev => [template, ...prev])
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(upload)
  }

  const deleteTemplate = async (id: string) => {
    setDeletingId(id)
    await fetch(`/api/contract-templates/${id}`, { method: 'DELETE' })
    setTemplates(prev => prev.filter(t => t.id !== id))
    setDeletingId(null)
  }

  const CATEGORY_COLORS: Record<string, string> = {
    purchase: '#4CAF9A', lease: '#7B8FD4', listing: '#C9A84C',
    disclosure: '#E07B6A', addendum: '#6ABDE0', other: '#aaa',
  }

  return (
    <section style={{ marginBottom: 28 }}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 14 }}>
        Contract Library
      </p>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#C9A84C' : 'var(--c-border)'}`,
          borderRadius: 12,
          padding: '28px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          backgroundColor: dragOver ? 'rgba(201,168,76,0.06)' : 'var(--c-card)',
          transition: 'all 0.15s',
          marginBottom: 16,
        }}
      >
        <input ref={fileRef} type="file" accept="application/pdf" multiple style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)} />
        {uploading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <div style={{ width: 18, height: 18, border: '2px solid var(--c-border)', borderTopColor: '#C9A84C', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 14, color: 'var(--c-text-2)' }}>Uploading…</span>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Drop PDFs here or click to browse</p>
            <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Upload blank contracts to reuse in signing sessions</p>
          </>
        )}
      </div>

      {uploadError && (
        <p style={{ fontSize: 13, color: '#ef4444', marginBottom: 12 }}>{uploadError}</p>
      )}

      {/* Template list */}
      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--c-text-2)', padding: '12px 0' }}>Loading library…</p>
      ) : templates.length === 0 ? (
        <div style={{ padding: '16px', backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>No contracts saved yet. Upload your first blank contract above.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templates.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 16px',
              backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12,
            }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>📄</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                    backgroundColor: `${CATEGORY_COLORS[t.category] ?? '#aaa'}22`,
                    color: CATEGORY_COLORS[t.category] ?? '#aaa',
                    textTransform: 'capitalize',
                  }}>{t.category}</span>
                  {t.page_count && <span style={{ fontSize: 12, color: 'var(--c-text-2)' }}>{t.page_count} page{t.page_count !== 1 ? 's' : ''}</span>}
                  <span style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
                    {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              </div>
              <button
                onClick={() => deleteTemplate(t.id)}
                disabled={deletingId === t.id}
                style={{
                  flexShrink: 0, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)',
                  color: deletingId === t.id ? 'var(--c-text-2)' : '#ef4444',
                  cursor: deletingId === t.id ? 'not-allowed' : 'pointer',
                }}
              >
                {deletingId === t.id ? '…' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </section>
  )
}

export default function PreferencesClient() {
  const [saved, setSaved] = useState(false)

  // Appearance
  const [theme,    setTheme]    = useState<Theme>('auto')

  // Navigation
  const [landing,  setLanding]  = useState<LandingPage>('/')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Tables
  const [rowsPer, setRowsPer] = useState<RowsPer>(50)
  const [denseRows, setDenseRows] = useState(false)

  // Dashboard
  const [dashboardLayout, setDashboardLayout] = useState('acquisition')

  // Load from localStorage
  useEffect(() => {
    const t = localStorage.getItem('nk_theme') as Theme | null
    if (t) setTheme(t)

    const l = localStorage.getItem('nk_landing') as LandingPage | null
    if (l) setLanding(l)

    const c = localStorage.getItem('nk_sidebar_collapsed')
    if (c !== null) setSidebarCollapsed(c === 'true')

    const r = localStorage.getItem('nk_rows_per')
    if (r) setRowsPer(Number(r) as RowsPer)

    const d = localStorage.getItem('nk_dense_rows')
    if (d !== null) setDenseRows(d === 'true')

    const dl = localStorage.getItem('nk_dashboard_layout')
    if (dl) setDashboardLayout(dl)
  }, [])

  const applyTheme = (t: Theme) => {
    setTheme(t)
    const root = document.documentElement
    if (t === 'dark') { root.setAttribute('data-theme', 'dark') }
    else if (t === 'light') { root.setAttribute('data-theme', 'light') }
    else { root.removeAttribute('data-theme') }
    localStorage.setItem('nk_theme', t)
  }

  const save = () => {
    localStorage.setItem('nk_landing', landing)
    localStorage.setItem('nk_sidebar_collapsed', String(sidebarCollapsed))
    localStorage.setItem('nk_rows_per', String(rowsPer))
    localStorage.setItem('nk_dense_rows', String(denseRows))
    localStorage.setItem('nk_dashboard_layout', dashboardLayout)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const LANDING_OPTIONS: { value: LandingPage; label: string }[] = [
    { value: '/',                label: 'Dashboard'       },
    { value: '/leads',           label: 'Leads'           },
    { value: '/contacts',        label: 'Contacts'        },
    { value: '/inbox',           label: 'Inbox'           },
    { value: '/pipeline',        label: 'Pipeline'        },
    { value: '/property-search', label: 'Property Search' },
  ]

  const LAYOUT_OPTIONS = [
    { value: 'acquisition',  label: 'Acquisition'  },
    { value: 'operations',   label: 'Operations'   },
    { value: 'executive',    label: 'Executive'    },
    { value: 'focus',        label: 'Focus'        },
  ]

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', color: 'var(--c-primary)' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Preferences</h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-2)' }}>Customize your workspace — changes are saved per device</p>
      </div>

      {saved && (
        <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontSize: 14, backgroundColor: 'rgba(74,207,154,0.12)', color: '#4ACF9A', border: '1px solid rgba(74,207,154,0.3)' }}>
          Preferences saved.
        </div>
      )}

      {/* Appearance */}
      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Appearance</p>
        <div style={S.card}>
          <div style={{ ...S.row, marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Color Theme</p>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Choose how NextKey OS appears on your device</p>
            </div>
            <div style={S.optionGroup}>
              {(['auto', 'light', 'dark'] as Theme[]).map(t => (
                <OptionButton key={t} label={t === 'auto' ? '⚙️ Auto' : t === 'light' ? '☀️ Light' : '🌙 Dark'} active={theme === t} onClick={() => applyTheme(t)} />
              ))}
            </div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-text-2)', padding: '10px 14px', backgroundColor: 'var(--c-hover)', borderRadius: 8 }}>
            Theme preference is saved locally. Auto follows your device system setting.
          </div>
        </div>
      </section>

      {/* Navigation */}
      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Navigation</p>
        <div style={S.card}>
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Default Landing Page</p>
            <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 12 }}>Where you land when you first sign in or click the logo</p>
            <div style={S.optionGroup}>
              {LANDING_OPTIONS.map(o => (
                <OptionButton key={o.value} label={o.label} active={landing === o.value} onClick={() => setLanding(o.value)} />
              ))}
            </div>
          </div>
          <Toggle checked={sidebarCollapsed} onChange={() => setSidebarCollapsed(v => !v)} label="Sidebar Collapsed by Default" desc="Start with the sidebar in compact icon-only mode" />
        </div>
      </section>

      {/* Dashboard */}
      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Dashboard</p>
        <div style={S.card}>
          <div style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Default Layout</p>
            <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 12 }}>Which preset layout loads when you open the dashboard</p>
            <div style={S.optionGroup}>
              {LAYOUT_OPTIONS.map(o => (
                <OptionButton key={o.value} label={o.label} active={dashboardLayout === o.value} onClick={() => setDashboardLayout(o.value)} />
              ))}
            </div>
          </div>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--c-border)' }}>
            <a href="/?edit=1" style={{ fontSize: 13, color: 'var(--c-text-2)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', borderRadius: 8 }}>
              Open Dashboard Customizer →
            </a>
          </div>
        </div>
      </section>

      {/* Tables */}
      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Tables & Lists</p>
        <div style={S.card}>
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Rows Per Page</p>
            <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 12 }}>Applies to Leads, Contacts, and Document tables</p>
            <div style={S.optionGroup}>
              {([25, 50, 100] as RowsPer[]).map(n => (
                <OptionButton key={n} label={`${n} rows`} active={rowsPer === n} onClick={() => setRowsPer(n)} />
              ))}
            </div>
          </div>
          <Toggle checked={denseRows} onChange={() => setDenseRows(v => !v)} label="Compact Row Density" desc="Smaller row height to show more records per page" />
        </div>
      </section>

      {/* Contract Library */}
      <ContractLibrary />

      {/* Save */}
      <button onClick={save} style={S.saveBtn}>Save Preferences</button>
    </div>
  )
}
