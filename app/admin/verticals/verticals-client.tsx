'use client'

import { useState, useEffect, useCallback } from 'react'

interface Vertical {
  id: string
  name: string
  color: string
  description: string | null
  is_active: boolean
  position: number
}

const S = {
  page:     { padding: '28px 32px', maxWidth: 900, margin: '0 auto' } as React.CSSProperties,
  header:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 } as React.CSSProperties,
  title:    { fontSize: 22, fontWeight: 700, color: 'var(--c-primary)' } as React.CSSProperties,
  addBtn:   { background: 'var(--c-gold,#C9A84C)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  card:     { background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 } as React.CSSProperties,
  swatch:   { width: 28, height: 28, borderRadius: 6, flexShrink: 0 } as React.CSSProperties,
  name:     { flex: 1, fontWeight: 600, fontSize: 14, color: 'var(--c-primary)' } as React.CSSProperties,
  desc:     { fontSize: 12, color: 'var(--c-text-2)', marginTop: 2 } as React.CSSProperties,
  badge:    (active: boolean) => ({ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: active ? 'rgba(74,207,154,0.12)' : 'rgba(150,150,150,0.12)', color: active ? '#4ACF9A' : 'var(--c-text-2)' }) as React.CSSProperties,
  iconBtn:  { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--c-text-2)', fontSize: 15 } as React.CSSProperties,
  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 } as React.CSSProperties,
  modal:    { background: 'var(--c-card)', borderRadius: 14, padding: 28, width: 440, border: '1px solid var(--c-border)' } as React.CSSProperties,
  label:    { fontSize: 12, fontWeight: 600, color: 'var(--c-text-2)', marginBottom: 4, display: 'block' } as React.CSSProperties,
  input:    { width: '100%', padding: '9px 12px', border: '1px solid var(--c-border)', borderRadius: 8, fontSize: 13, background: 'var(--c-input-bg,var(--c-card))', color: 'var(--c-primary)', boxSizing: 'border-box' as const, marginBottom: 12 } as React.CSSProperties,
  saveBtn:  { background: 'var(--c-gold,#C9A84C)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  cancelBtn:{ background: 'none', border: '1px solid var(--c-border)', borderRadius: 8, padding: '9px 20px', fontSize: 13, cursor: 'pointer', color: 'var(--c-text-2)' } as React.CSSProperties,
}

const EMPTY = { name: '', color: '#0A1F44', description: '', is_active: true }

export default function VerticalsClient() {
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing]     = useState<Vertical | null>(null)
  const [form, setForm]           = useState(EMPTY)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/business-verticals')
    if (res.ok) setVerticals(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing(null)
    setForm(EMPTY)
    setError('')
    setShowModal(true)
  }

  function openEdit(v: Vertical) {
    setEditing(v)
    setForm({ name: v.name, color: v.color, description: v.description ?? '', is_active: v.is_active })
    setError('')
    setShowModal(true)
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      const url    = editing ? `/api/business-verticals/${editing.id}` : '/api/business-verticals'
      const method = editing ? 'PATCH' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed.'); return }
      setShowModal(false)
      await load()
    } finally { setSaving(false) }
  }

  async function remove(v: Vertical) {
    if (!confirm(`Delete "${v.name}"? This cannot be undone.`)) return
    await fetch(`/api/business-verticals/${v.id}`, { method: 'DELETE' })
    await load()
  }

  async function toggle(v: Vertical) {
    await fetch(`/api/business-verticals/${v.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !v.is_active }),
    })
    await load()
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Business Verticals</h1>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginTop: 4 }}>
            Define the business lines this platform tracks (Real Estate, Commercial, Rentals, etc.)
          </p>
        </div>
        <button style={S.addBtn} onClick={openNew}>+ Add Vertical</button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--c-text-2)', fontSize: 13 }}>Loading…</p>
      ) : verticals.length === 0 ? (
        <p style={{ color: 'var(--c-text-2)', fontSize: 13 }}>No verticals yet. Add one to get started.</p>
      ) : (
        verticals.map(v => (
          <div key={v.id} style={S.card}>
            <div style={{ ...S.swatch, background: v.color }} />
            <div style={{ flex: 1 }}>
              <div style={S.name}>{v.name}</div>
              {v.description && <div style={S.desc}>{v.description}</div>}
            </div>
            <span style={S.badge(v.is_active)}>{v.is_active ? 'Active' : 'Inactive'}</span>
            <button style={S.iconBtn} title="Toggle active" onClick={() => toggle(v)}>
              {v.is_active ? '⏸' : '▶'}
            </button>
            <button style={S.iconBtn} title="Edit" onClick={() => openEdit(v)}>✏️</button>
            <button style={{ ...S.iconBtn, color: '#ef4444' }} title="Delete" onClick={() => remove(v)}>🗑</button>
          </div>
        ))
      )}

      {showModal && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={S.modal}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-primary)', marginBottom: 20 }}>
              {editing ? 'Edit Vertical' : 'New Vertical'}
            </h2>

            <label style={S.label}>Name *</label>
            <input
              style={S.input}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Residential Real Estate"
            />

            <label style={S.label}>Color</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <input
                type="color"
                value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                style={{ width: 44, height: 36, border: '1px solid var(--c-border)', borderRadius: 6, cursor: 'pointer', padding: 2 }}
              />
              <input
                style={{ ...S.input, margin: 0, flex: 1 }}
                value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
              />
            </div>

            <label style={S.label}>Description</label>
            <input
              style={S.input}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description"
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--c-primary)', cursor: 'pointer', marginBottom: 20 }}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              />
              Active
            </label>

            {error && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button style={S.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={S.saveBtn} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
