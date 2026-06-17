'use client'

import { useState, useEffect } from 'react'

interface OfferProfile {
  id: string
  name: string
  buyer_name?: string
  closing_days?: number
  inspection_days?: number
  earnest_money?: number
  default_clauses?: string
  is_default: boolean
}

const EMPTY: Omit<OfferProfile, 'id' | 'is_default'> = {
  name: '', buyer_name: '', closing_days: undefined, inspection_days: undefined,
  earnest_money: undefined, default_clauses: '',
}

const PRESETS = ['Wholesale', 'Retail', 'Airbnb', 'Fix & Flip', 'Subject-To']

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
  border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)',
  color: 'var(--c-primary)', boxSizing: 'border-box',
}

export default function OfferProfilesClient() {
  const [profiles, setProfiles]   = useState<OfferProfile[]>([])
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState<OfferProfile | null>(null)
  const [creating, setCreating]   = useState(false)
  const [form, setForm]           = useState<typeof EMPTY>({ ...EMPTY })
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [banner, setBanner]       = useState<string | null>(null)

  const load = () => {
    fetch('/api/offer-profiles')
      .then(r => r.json())
      .then(d => setProfiles(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const flash = (msg: string) => { setBanner(msg); setTimeout(() => setBanner(null), 3000) }

  const startCreate = (preset?: string) => {
    setEditing(null)
    setForm({ ...EMPTY, name: preset ?? '' })
    setIsDefault(false)
    setCreating(true)
  }
  const startEdit = (p: OfferProfile) => {
    setCreating(false)
    setForm({
      name: p.name, buyer_name: p.buyer_name ?? '', closing_days: p.closing_days,
      inspection_days: p.inspection_days, earnest_money: p.earnest_money,
      default_clauses: p.default_clauses ?? '',
    })
    setIsDefault(p.is_default)
    setEditing(p)
  }
  const cancel = () => { setEditing(null); setCreating(false) }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = {
      ...form,
      closing_days:    form.closing_days    ? Number(form.closing_days)    : null,
      inspection_days: form.inspection_days ? Number(form.inspection_days) : null,
      earnest_money:   form.earnest_money   ? Number(form.earnest_money)   : null,
      is_default: isDefault,
    }
    try {
      if (creating) {
        const r = await fetch('/api/offer-profiles', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!r.ok) throw new Error()
      } else if (editing) {
        const r = await fetch(`/api/offer-profiles/${editing.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!r.ok) throw new Error()
      }
      flash('Profile saved.')
      cancel()
      load()
    } catch {
      flash('Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const deleteProfile = async (p: OfferProfile) => {
    if (!confirm(`Delete "${p.name}" profile?`)) return
    await fetch(`/api/offer-profiles/${p.id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div style={{ color: 'var(--c-primary)', maxWidth: 820, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <a href="/settings" style={{ fontSize: 13, color: 'var(--c-text-2)', textDecoration: 'none' }}>← Settings</a>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Offer Profiles</h1>
          <p style={{ fontSize: 14, color: 'var(--c-text-2)' }}>
            Each profile stores a buyer name, timelines, and clauses for a specific deal type. One click pre-fills your contract.
          </p>
        </div>
        {!creating && !editing && (
          <button
            onClick={() => startCreate()}
            style={{
              padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
              backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', flexShrink: 0,
            }}
          >
            + New Profile
          </button>
        )}
      </div>

      {banner && (
        <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontSize: 13, backgroundColor: 'rgba(74,207,154,0.12)', color: '#4ACF9A', border: '1px solid rgba(74,207,154,0.3)' }}>
          {banner}
        </div>
      )}

      {/* Quick-start presets — shown when no profiles exist */}
      {!loading && profiles.length === 0 && !creating && !editing && (
        <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '24px', marginBottom: 20 }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Quick Start</p>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 16 }}>Create a profile from a common template:</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {PRESETS.map(p => (
              <button key={p} onClick={() => startCreate(p)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)', border: '1px solid var(--c-border)', cursor: 'pointer' }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Form */}
      {(creating || editing) && (
        <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid #C9A84C', borderRadius: 14, padding: '24px', marginBottom: 20 }}>
          <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 20 }}>
            {creating ? 'New Offer Profile' : `Edit: ${editing?.name}`}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>Profile Name *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} style={inp} placeholder="e.g. Wholesale" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>Buyer Name</label>
              <input value={form.buyer_name ?? ''} onChange={e => setForm(p => ({ ...p, buyer_name: e.target.value }))} style={inp} placeholder="e.g. Charles Gonzalez / NextKey LLC" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>Closing Days</label>
              <input type="number" value={form.closing_days ?? ''} onChange={e => setForm(p => ({ ...p, closing_days: Number(e.target.value) || undefined }))} style={inp} placeholder="30" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>Inspection Days</label>
              <input type="number" value={form.inspection_days ?? ''} onChange={e => setForm(p => ({ ...p, inspection_days: Number(e.target.value) || undefined }))} style={inp} placeholder="10" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>Default EMD ($)</label>
              <input type="number" value={form.earnest_money ?? ''} onChange={e => setForm(p => ({ ...p, earnest_money: Number(e.target.value) || undefined }))} style={inp} placeholder="1000" />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>Default Clauses / Notes</label>
            <textarea
              value={form.default_clauses ?? ''}
              onChange={e => setForm(p => ({ ...p, default_clauses: e.target.value }))}
              rows={4}
              style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }}
              placeholder="Any default clauses or notes to include in contracts using this profile..."
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 20, cursor: 'pointer' }}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} style={{ width: 16, height: 16 }} />
            Set as default profile (auto-selected when generating contracts)
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={save}
              disabled={saving || !form.name.trim()}
              style={{ padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Save Profile'}
            </button>
            <button onClick={cancel} style={{ padding: '9px 18px', borderRadius: 8, fontSize: 13, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Profile list */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-text-2)', fontSize: 14 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {profiles.map(p => (
            <div key={p.id} style={{
              backgroundColor: 'var(--c-card)',
              border: `1px solid ${p.is_default ? '#C9A84C' : editing?.id === p.id ? '#C9A84C' : 'var(--c-border)'}`,
              borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                  {p.is_default && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>Default</span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
                  {[
                    p.buyer_name && `Buyer: ${p.buyer_name}`,
                    p.closing_days && `${p.closing_days}d close`,
                    p.inspection_days && `${p.inspection_days}d inspection`,
                    p.earnest_money && `$${Number(p.earnest_money).toLocaleString()} EMD`,
                  ].filter(Boolean).join(' · ') || 'No defaults set'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => startEdit(p)} style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)', cursor: 'pointer' }}>
                  Edit
                </button>
                <button onClick={() => deleteProfile(p)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 12, backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
