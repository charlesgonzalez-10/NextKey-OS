'use client'

import { useState, useEffect, useCallback } from 'react'

interface Stage {
  id?: string
  name: string
  color: string
  probability: number
  is_closed_won: boolean
  is_closed_lost: boolean
  position: number
}

interface Pipeline {
  id: string
  name: string
  description: string | null
  is_default: boolean
  is_active: boolean
  position: number
  pipeline_stages: Stage[]
}

const DEFAULT_STAGES: Stage[] = [
  { name: 'New Lead',      color: '#6B7280', probability: 10, is_closed_won: false, is_closed_lost: false, position: 1 },
  { name: 'Contacted',     color: '#3B82F6', probability: 25, is_closed_won: false, is_closed_lost: false, position: 2 },
  { name: 'Appointment',   color: '#8B5CF6', probability: 40, is_closed_won: false, is_closed_lost: false, position: 3 },
  { name: 'Offer Made',    color: '#F59E0B', probability: 60, is_closed_won: false, is_closed_lost: false, position: 4 },
  { name: 'Under Contract',color: '#10B981', probability: 80, is_closed_won: false, is_closed_lost: false, position: 5 },
  { name: 'Closed',        color: '#4ACF9A', probability: 100, is_closed_won: true,  is_closed_lost: false, position: 6 },
  { name: 'Dead',          color: '#EF4444', probability: 0,   is_closed_won: false, is_closed_lost: true,  position: 7 },
]

const S = {
  page:     { padding: '28px 32px', maxWidth: 960, margin: '0 auto' } as React.CSSProperties,
  header:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 } as React.CSSProperties,
  title:    { fontSize: 22, fontWeight: 700, color: 'var(--c-primary)' } as React.CSSProperties,
  addBtn:   { background: 'var(--c-gold,#C9A84C)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  pCard:    { background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '18px 20px', marginBottom: 14 } as React.CSSProperties,
  pHeader:  { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 } as React.CSSProperties,
  pName:    { flex: 1, fontWeight: 700, fontSize: 16, color: 'var(--c-primary)' } as React.CSSProperties,
  pDesc:    { fontSize: 12, color: 'var(--c-text-2)', marginTop: 2 } as React.CSSProperties,
  stagesRow:{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 } as React.CSSProperties,
  stagePill:{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, color: '#fff' } as React.CSSProperties,
  badge:    (active: boolean) => ({ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: active ? 'rgba(74,207,154,0.12)' : 'rgba(150,150,150,0.12)', color: active ? '#4ACF9A' : 'var(--c-text-2)' }) as React.CSSProperties,
  defBadge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'rgba(201,168,76,0.15)', color: '#C9A84C' } as React.CSSProperties,
  iconBtn:  { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--c-text-2)', fontSize: 15 } as React.CSSProperties,
  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 } as React.CSSProperties,
  modal:    { background: 'var(--c-card)', borderRadius: 14, padding: 28, width: 620, maxHeight: '90vh', overflowY: 'auto' as const, border: '1px solid var(--c-border)' } as React.CSSProperties,
  label:    { fontSize: 12, fontWeight: 600, color: 'var(--c-text-2)', marginBottom: 4, display: 'block' } as React.CSSProperties,
  input:    { width: '100%', padding: '9px 12px', border: '1px solid var(--c-border)', borderRadius: 8, fontSize: 13, background: 'var(--c-input-bg,var(--c-card))', color: 'var(--c-primary)', boxSizing: 'border-box' as const, marginBottom: 12 } as React.CSSProperties,
  saveBtn:  { background: 'var(--c-gold,#C9A84C)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  cancelBtn:{ background: 'none', border: '1px solid var(--c-border)', borderRadius: 8, padding: '9px 20px', fontSize: 13, cursor: 'pointer', color: 'var(--c-text-2)' } as React.CSSProperties,
  stageRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--c-hover,rgba(0,0,0,0.04))', borderRadius: 8, marginBottom: 6 } as React.CSSProperties,
}

const EMPTY_PIPELINE = { name: '', description: '', is_default: false, is_active: true }

export default function PipelinesClient() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing]     = useState<Pipeline | null>(null)
  const [form, setForm]           = useState(EMPTY_PIPELINE)
  const [stages, setStages]       = useState<Stage[]>(DEFAULT_STAGES)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/pipelines')
    if (res.ok) setPipelines(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing(null)
    setForm(EMPTY_PIPELINE)
    setStages(DEFAULT_STAGES.map((s, i) => ({ ...s, position: i + 1 })))
    setError('')
    setShowModal(true)
  }

  function openEdit(p: Pipeline) {
    setEditing(p)
    setForm({ name: p.name, description: p.description ?? '', is_default: p.is_default, is_active: p.is_active })
    setStages(p.pipeline_stages.map((s, i) => ({ ...s, position: s.position ?? i + 1 })))
    setError('')
    setShowModal(true)
  }

  function updateStage(idx: number, field: keyof Stage, value: unknown) {
    setStages(ss => ss.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  function addStage() {
    setStages(ss => [...ss, {
      name: '', color: '#6B7280', probability: 0,
      is_closed_won: false, is_closed_lost: false, position: ss.length + 1,
    }])
  }

  function removeStage(idx: number) {
    setStages(ss => ss.filter((_, i) => i !== idx).map((s, i) => ({ ...s, position: i + 1 })))
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      if (editing) {
        const existingIds    = editing.pipeline_stages.map(s => s.id)
        const updatedIds     = stages.filter(s => s.id).map(s => s.id)
        const deleteStageIds = existingIds.filter(id => !updatedIds.includes(id))
        const res = await fetch(`/api/pipelines/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, stages, delete_stage_ids: deleteStageIds }),
        })
        if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed.'); return }
      } else {
        const res = await fetch('/api/pipelines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, stages }),
        })
        if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed.'); return }
      }
      setShowModal(false)
      await load()
    } finally { setSaving(false) }
  }

  async function remove(p: Pipeline) {
    if (!confirm(`Delete pipeline "${p.name}" and all its stages? This cannot be undone.`)) return
    await fetch(`/api/pipelines/${p.id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Pipelines</h1>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginTop: 4 }}>
            Configure deal pipelines with custom stages for each business line
          </p>
        </div>
        <button style={S.addBtn} onClick={openNew}>+ Add Pipeline</button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--c-text-2)', fontSize: 13 }}>Loading…</p>
      ) : pipelines.length === 0 ? (
        <p style={{ color: 'var(--c-text-2)', fontSize: 13 }}>No pipelines yet. Create one to get started.</p>
      ) : (
        pipelines.map(p => (
          <div key={p.id} style={S.pCard}>
            <div style={S.pHeader}>
              <div style={{ flex: 1 }}>
                <div style={S.pName}>{p.name}</div>
                {p.description && <div style={S.pDesc}>{p.description}</div>}
              </div>
              {p.is_default && <span style={S.defBadge}>Default</span>}
              <span style={S.badge(p.is_active)}>{p.is_active ? 'Active' : 'Inactive'}</span>
              <button style={S.iconBtn} title="Edit" onClick={() => openEdit(p)}>✏️</button>
              <button style={{ ...S.iconBtn, color: '#ef4444' }} title="Delete" onClick={() => remove(p)}>🗑</button>
            </div>
            <div style={S.stagesRow}>
              {p.pipeline_stages.map(s => (
                <div key={s.id ?? s.name} style={{ ...S.stagePill, background: s.color }}>
                  {s.name}
                  {s.probability > 0 && <span style={{ opacity: 0.8 }}> {s.probability}%</span>}
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {showModal && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={S.modal}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-primary)', marginBottom: 20 }}>
              {editing ? 'Edit Pipeline' : 'New Pipeline'}
            </h2>

            <label style={S.label}>Name *</label>
            <input
              style={S.input}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Wholesale Deals"
            />

            <label style={S.label}>Description</label>
            <input
              style={S.input}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional"
            />

            <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--c-primary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                Active
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--c-primary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} />
                Default pipeline
              </label>
            </div>

            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ ...S.label, margin: 0 }}>Stages</p>
              <button
                style={{ fontSize: 12, background: 'none', border: '1px solid var(--c-border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', color: 'var(--c-text-2)' }}
                onClick={addStage}
              >
                + Add Stage
              </button>
            </div>

            {stages.map((stage, idx) => (
              <div key={idx} style={S.stageRow}>
                <input
                  style={{ ...S.input, margin: 0, flex: 2 }}
                  value={stage.name}
                  onChange={e => updateStage(idx, 'name', e.target.value)}
                  placeholder="Stage name"
                />
                <input
                  type="color"
                  value={stage.color}
                  onChange={e => updateStage(idx, 'color', e.target.value)}
                  style={{ width: 32, height: 32, border: '1px solid var(--c-border)', borderRadius: 6, cursor: 'pointer', padding: 2, flexShrink: 0 }}
                />
                <input
                  type="number"
                  min={0} max={100}
                  value={stage.probability}
                  onChange={e => updateStage(idx, 'probability', Number(e.target.value))}
                  style={{ ...S.input, margin: 0, width: 70, flexShrink: 0 }}
                  title="Win probability %"
                />
                <span style={{ fontSize: 11, color: 'var(--c-text-2)', flexShrink: 0 }}>%</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#4ACF9A', flexShrink: 0, cursor: 'pointer' }} title="Closed Won">
                  <input type="checkbox" checked={stage.is_closed_won} onChange={e => updateStage(idx, 'is_closed_won', e.target.checked)} />
                  Won
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#EF4444', flexShrink: 0, cursor: 'pointer' }} title="Closed Lost">
                  <input type="checkbox" checked={stage.is_closed_lost} onChange={e => updateStage(idx, 'is_closed_lost', e.target.checked)} />
                  Lost
                </label>
                <button style={{ ...S.iconBtn, color: '#ef4444', flexShrink: 0 }} onClick={() => removeStage(idx)}>✕</button>
              </div>
            ))}

            {error && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 12, marginTop: 8 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button style={S.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={S.saveBtn} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save Pipeline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
