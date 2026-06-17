'use client'

import { useState, useEffect } from 'react'

interface Signature {
  id: string
  name: string
  content: string
  is_default: boolean
  created_at: string
  updated_at: string
}

const PRESETS = [
  {
    name: 'Personal',
    content: `<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#333">
  <strong>{{User.FirstName}} {{User.LastName}}</strong><br>
  {{Company.Name}}<br>
  <a href="tel:{{User.Phone}}">{{User.Phone}}</a> · <a href="mailto:{{User.Email}}">{{User.Email}}</a>
</p>`,
  },
  {
    name: 'Investor',
    content: `<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#333">
  <strong>{{User.FirstName}} {{User.LastName}}</strong><br>
  Real Estate Investor · {{Company.Name}}<br>
  <a href="tel:{{User.Phone}}">{{User.Phone}}</a><br>
  <em style="font-size:11px;color:#888">We buy houses in any condition, cash, fast closing.</em>
</p>`,
  },
  {
    name: 'Realtor',
    content: `<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#333">
  <strong>{{User.FirstName}} {{User.LastName}}</strong>, Licensed Realtor<br>
  {{Company.Name}}<br>
  <a href="tel:{{User.Phone}}">{{User.Phone}}</a> · <a href="mailto:{{User.Email}}">{{User.Email}}</a><br>
  <em style="font-size:11px;color:#888">License #{{Contract.TitleCompany}}</em>
</p>`,
  },
]

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
  border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)',
  color: 'var(--c-primary)', boxSizing: 'border-box',
}

export default function EmailSignaturesClient() {
  const [signatures, setSignatures] = useState<Signature[]>([])
  const [loading,    setLoading]    = useState(true)
  const [creating,   setCreating]   = useState(false)
  const [editing,    setEditing]    = useState<Signature | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [deleting,   setDeleting]   = useState<string | null>(null)
  const [banner,     setBanner]     = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [previewId,  setPreviewId]  = useState<string | null>(null)

  const [form, setForm] = useState({ name: '', content: '', is_default: false })

  const showBanner = (type: 'ok' | 'err', msg: string) => {
    setBanner({ type, msg })
    setTimeout(() => setBanner(null), 3000)
  }

  const load = () => {
    fetch('/api/email-signatures')
      .then(r => r.json())
      .then(data => { setSignatures(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!form.name.trim() || !form.content.trim()) { showBanner('err', 'Name and content are required'); return }
    setSaving(true)
    const res = await fetch('/api/email-signatures', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) { setCreating(false); setForm({ name: '', content: '', is_default: false }); load(); showBanner('ok', 'Signature created') }
    else { const d = await res.json(); showBanner('err', d.error ?? 'Failed to create') }
  }

  const handleUpdate = async () => {
    if (!editing) return
    setSaving(true)
    const res = await fetch(`/api/email-signatures/${editing.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editing.name, content: editing.content, is_default: editing.is_default }),
    })
    setSaving(false)
    if (res.ok) { setEditing(null); load(); showBanner('ok', 'Signature updated') }
    else { const d = await res.json(); showBanner('err', d.error ?? 'Failed to update') }
  }

  const handleSetDefault = async (id: string) => {
    await fetch(`/api/email-signatures/${id}`, { method: 'PATCH' })
    load()
    showBanner('ok', 'Default signature updated')
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this signature?')) return
    setDeleting(id)
    await fetch(`/api/email-signatures/${id}`, { method: 'DELETE' })
    setDeleting(null); load()
    showBanner('ok', 'Signature deleted')
  }

  const signatureForm = (isEdit: boolean) => {
    const f    = isEdit && editing ? editing : form
    const setF = isEdit && editing
      ? (patch: Partial<typeof form>) => setEditing({ ...editing!, ...patch })
      : (patch: Partial<typeof form>) => setForm({ ...form, ...patch })

    return (
      <div style={{ border: '1px solid var(--c-border)', borderRadius: 12, padding: 18, marginBottom: 16, backgroundColor: 'var(--c-card-alt)' }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 4 }}>Signature Name</label>
            <input value={f.name} onChange={e => setF({ name: e.target.value })} placeholder="e.g. Personal, Investor, Realtor" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 1 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--c-primary)', userSelect: 'none' }}>
              <input type="checkbox" checked={f.is_default} onChange={e => setF({ is_default: e.target.checked })} />
              Set as default
            </label>
          </div>
        </div>

        {!isEdit && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 6 }}>Quick-start from preset</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {PRESETS.map(p => (
                <button key={p.name} onClick={() => setF({ name: p.name, content: p.content })}
                  style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 4 }}>
            HTML Content
            <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--c-text-3)' }}>— supports {'{{User.FirstName}}'}, {'{{Company.Name}}'}, etc.</span>
          </label>
          <textarea value={f.content} onChange={e => setF({ content: e.target.value })} rows={8}
            placeholder="<p>Your Name<br>Company | Phone | Email</p>"
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
        </div>

        {f.content && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text-2)', marginBottom: 6 }}>Preview</div>
            <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: '12px 16px', backgroundColor: '#fff', minHeight: 60 }}
              dangerouslySetInnerHTML={{ __html: f.content }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={isEdit ? handleUpdate : handleCreate} disabled={saving}
            style={{ padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Update Signature' : 'Create Signature'}
          </button>
          <button onClick={() => isEdit ? setEditing(null) : setCreating(false)}
            style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 24px' }}>
      {/* Back link */}
      <a href="/settings" style={{ fontSize: 13, color: 'var(--c-text-2)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 24 }}>
        ← Back to Settings
      </a>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Email Signatures</h1>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Manage multiple signatures for different contexts. The default is auto-appended when composing.</p>
        </div>
        <button onClick={() => { setCreating(v => !v); setEditing(null) }}
          style={{ padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}>
          + New Signature
        </button>
      </div>

      {banner && (
        <div style={{ marginBottom: 16, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: banner.type === 'ok' ? '#f0fdf4' : '#fef2f2', color: banner.type === 'ok' ? '#16a34a' : '#ef4444', border: `1px solid ${banner.type === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {banner.msg}
        </div>
      )}

      {creating && signatureForm(false)}

      {loading && <div style={{ color: 'var(--c-text-3)', fontSize: 13, padding: '24px 0' }}>Loading…</div>}

      {!loading && signatures.length === 0 && !creating && (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✉️</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No signatures yet</div>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 16 }}>Create a signature to auto-append to your emails.</p>
          <button onClick={() => setCreating(true)}
            style={{ padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}>
            Create First Signature
          </button>
        </div>
      )}

      {signatures.map(sig => (
        <div key={sig.id}>
          {editing?.id === sig.id ? (
            signatureForm(true)
          ) : (
            <div style={{ border: `1px solid ${sig.is_default ? '#C9A84C60' : 'var(--c-border)'}`, borderRadius: 12, padding: '16px 20px', marginBottom: 12, backgroundColor: 'var(--c-card)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{sig.name}</span>
                  {sig.is_default && (
                    <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: '#C9A84C20', color: '#C9A84C', padding: '2px 8px', borderRadius: 8, border: '1px solid #C9A84C40' }}>
                      DEFAULT
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setPreviewId(previewId === sig.id ? null : sig.id)}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                    {previewId === sig.id ? 'Hide' : 'Preview'}
                  </button>
                  {!sig.is_default && (
                    <button onClick={() => handleSetDefault(sig.id)}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                      Set Default
                    </button>
                  )}
                  <button onClick={() => { setEditing({ ...sig }); setCreating(false) }}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                    Edit
                  </button>
                  <button onClick={() => handleDelete(sig.id)} disabled={deleting === sig.id}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer' }}>
                    {deleting === sig.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>

              {previewId === sig.id && (
                <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: '12px 16px', backgroundColor: '#fff', marginBottom: 8 }}
                  dangerouslySetInnerHTML={{ __html: sig.content }} />
              )}

              <div style={{ fontSize: 10, color: 'var(--c-text-3)' }}>
                Updated {new Date(sig.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
