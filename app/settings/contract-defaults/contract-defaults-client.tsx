'use client'

import { useState, useEffect } from 'react'

interface ContractSettings {
  company_name?: string
  entity_name?: string
  mailing_address?: string
  phone?: string
  email?: string
  website?: string
  broker_name?: string
  broker_license?: string
  license_number?: string
  buyer_name?: string
  acceptance_days?: number
  inspection_days?: number
  closing_days?: number
  earnest_money_amount?: number
  closing_location?: string
  escrow_instructions?: string
}

interface TitleCompany {
  id: string
  company_name: string
  contact_name?: string
  email?: string
  phone?: string
  address?: string
  notes?: string
  is_default: boolean
}

const EMPTY_TC: Omit<TitleCompany, 'id' | 'is_default'> = {
  company_name: '', contact_name: '', email: '', phone: '', address: '', notes: '',
}

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
  border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)',
  color: 'var(--c-primary)', boxSizing: 'border-box',
}

export default function ContractDefaultsClient() {
  const [settings, setSettings] = useState<ContractSettings>({})
  const [saving, setSaving]     = useState(false)
  const [banner, setBanner]     = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  // Title companies
  const [companies, setCompanies]     = useState<TitleCompany[]>([])
  const [editingTC, setEditingTC]     = useState<TitleCompany | null>(null)
  const [creatingTC, setCreatingTC]   = useState(false)
  const [tcForm, setTcForm]           = useState<typeof EMPTY_TC>({ ...EMPTY_TC })
  const [tcDefault, setTcDefault]     = useState(false)
  const [savingTC, setSavingTC]       = useState(false)

  useEffect(() => {
    fetch('/api/contract-settings').then(r => r.json()).then(d => setSettings(d ?? {})).catch(() => {})
    loadCompanies()
  }, [])

  const loadCompanies = () => {
    fetch('/api/title-companies').then(r => r.json()).then(d => setCompanies(Array.isArray(d) ? d : [])).catch(() => {})
  }

  const flash = (type: 'success' | 'error', msg: string) => {
    setBanner({ type, msg })
    setTimeout(() => setBanner(null), 3000)
  }

  const saveSettings = async () => {
    setSaving(true)
    const res = await fetch('/api/contract-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    if (res.ok) flash('success', 'Contract defaults saved.')
    else flash('error', 'Failed to save.')
    setSaving(false)
  }

  const set = (key: keyof ContractSettings, val: string | number) =>
    setSettings(p => ({ ...p, [key]: val }))

  // Title company handlers
  const startCreateTC = () => {
    setEditingTC(null)
    setTcForm({ ...EMPTY_TC })
    setTcDefault(false)
    setCreatingTC(true)
  }
  const startEditTC = (tc: TitleCompany) => {
    setCreatingTC(false)
    setTcForm({
      company_name: tc.company_name, contact_name: tc.contact_name ?? '',
      email: tc.email ?? '', phone: tc.phone ?? '', address: tc.address ?? '', notes: tc.notes ?? '',
    })
    setTcDefault(tc.is_default)
    setEditingTC(tc)
  }
  const cancelTC = () => { setCreatingTC(false); setEditingTC(null) }

  const saveTC = async () => {
    if (!tcForm.company_name.trim()) return
    setSavingTC(true)
    const payload = { ...tcForm, is_default: tcDefault }
    try {
      if (creatingTC) {
        const r = await fetch('/api/title-companies', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!r.ok) throw new Error()
      } else if (editingTC) {
        const r = await fetch(`/api/title-companies/${editingTC.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!r.ok) throw new Error()
      }
      cancelTC()
      loadCompanies()
    } catch {
      flash('error', 'Failed to save title company.')
    } finally {
      setSavingTC(false)
    }
  }

  const setDefault = async (tc: TitleCompany) => {
    await fetch(`/api/title-companies/${tc.id}`, { method: 'PATCH' })
    loadCompanies()
  }

  const deleteTC = async (tc: TitleCompany) => {
    if (!confirm(`Delete "${tc.company_name}"?`)) return
    await fetch(`/api/title-companies/${tc.id}`, { method: 'DELETE' })
    loadCompanies()
  }

  const numInp = (key: keyof ContractSettings, label: string, placeholder: string) => (
    <div>
      <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>{label}</label>
      <input
        type="number"
        value={String(settings[key] ?? '')}
        onChange={e => set(key, Number(e.target.value))}
        placeholder={placeholder}
        style={inp}
      />
    </div>
  )

  const textInp = (key: keyof ContractSettings, label: string, placeholder: string) => (
    <div>
      <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>{label}</label>
      <input
        value={String(settings[key] ?? '')}
        onChange={e => set(key, e.target.value)}
        placeholder={placeholder}
        style={inp}
      />
    </div>
  )

  const card = (children: React.ReactNode) => (
    <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '20px 24px', marginBottom: 16 }}>
      {children}
    </div>
  )

  return (
    <div style={{ color: 'var(--c-primary)', maxWidth: 820, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <a href="/settings" style={{ fontSize: 13, color: 'var(--c-text-2)', textDecoration: 'none' }}>← Settings</a>
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Contract Defaults</h1>
      <p style={{ fontSize: 14, color: 'var(--c-text-2)', marginBottom: 28 }}>
        These values auto-fill every contract you generate. No need to re-enter them each time.
      </p>

      {banner && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontSize: 13,
          backgroundColor: banner.type === 'success' ? 'rgba(74,207,154,0.12)' : 'rgba(239,68,68,0.12)',
          color: banner.type === 'success' ? '#4ACF9A' : '#ef4444',
          border: `1px solid ${banner.type === 'success' ? 'rgba(74,207,154,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>
          {banner.msg}
        </div>
      )}

      {/* ── Company Defaults ── */}
      <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 12 }}>
        Company Defaults
      </h2>
      {card(
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {textInp('company_name',    'Company Name',    'NextKey Property Solutions')}
          {textInp('entity_name',     'Entity / LLC Name', 'NextKey LLC')}
          {textInp('buyer_name',      'Default Buyer Name', 'Charles Gonzalez')}
          {textInp('phone',           'Phone',            '(305) 555-0100')}
          {textInp('email',           'Email',            'charles@nextkeyps.com')}
          {textInp('website',         'Website',          'nextkeyps.com')}
          <div style={{ gridColumn: '1 / -1' }}>
            {textInp('mailing_address', 'Mailing Address', '123 Main St, Miami FL 33101')}
          </div>
        </div>
      )}

      {/* ── Broker / License ── */}
      <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 12, marginTop: 8 }}>
        Broker / License (optional)
      </h2>
      {card(
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          {textInp('broker_name',    'Broker Name',     'Jane Smith')}
          {textInp('broker_license', 'Broker License',  'BK3123456')}
          {textInp('license_number', 'Your License #',  'SL3456789')}
        </div>
      )}

      {/* ── Transaction Defaults ── */}
      <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 12, marginTop: 8 }}>
        Transaction Defaults
      </h2>
      {card(
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
            {numInp('acceptance_days',     'Acceptance Days',  '3')}
            {numInp('inspection_days',     'Inspection Days',  '10')}
            {numInp('closing_days',        'Closing Days',     '30')}
            {numInp('earnest_money_amount','Default EMD ($)',  '1000')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {textInp('closing_location',    'Preferred Closing Location', 'Broward County Title')}
            {textInp('escrow_instructions', 'Escrow Instructions',        'Standard escrow')}
          </div>
        </>
      )}

      <button
        onClick={saveSettings}
        disabled={saving}
        style={{
          padding: '10px 28px', borderRadius: 8, fontSize: 14, fontWeight: 600,
          backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none',
          cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1, marginBottom: 40,
        }}
      >
        {saving ? 'Saving…' : 'Save Contract Defaults'}
      </button>

      {/* ── Title Companies ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)' }}>
          Title Companies
        </h2>
        {!creatingTC && !editingTC && (
          <button
            onClick={startCreateTC}
            style={{
              padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C',
              border: '1px solid rgba(201,168,76,0.3)', cursor: 'pointer',
            }}
          >
            + Add Title Company
          </button>
        )}
      </div>

      {(creatingTC || editingTC) && (
        <div style={{
          backgroundColor: 'var(--c-card)', border: '1px solid #C9A84C',
          borderRadius: 14, padding: '20px 24px', marginBottom: 16,
        }}>
          <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>
            {creatingTC ? 'New Title Company' : `Edit: ${editingTC?.company_name}`}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            {(['company_name', 'contact_name', 'email', 'phone', 'address', 'notes'] as const).map(k => (
              <div key={k} style={k === 'notes' || k === 'address' ? { gridColumn: '1 / -1' } : {}}>
                <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 4 }}>
                  {k === 'company_name' ? 'Company Name *' : k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </label>
                <input
                  value={tcForm[k]}
                  onChange={e => setTcForm(p => ({ ...p, [k]: e.target.value }))}
                  style={inp}
                  placeholder={k === 'company_name' ? 'Broward County Title' : ''}
                />
              </div>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={tcDefault}
              onChange={e => setTcDefault(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Set as Default Title Company
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={saveTC}
              disabled={savingTC || !tcForm.company_name.trim()}
              style={{
                padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none',
                cursor: savingTC ? 'wait' : 'pointer', opacity: savingTC ? 0.7 : 1,
              }}
            >
              {savingTC ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancelTC} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 40 }}>
        {companies.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--c-text-2)', fontSize: 14, backgroundColor: 'var(--c-card)', borderRadius: 12, border: '1px dashed var(--c-border)' }}>
            No title companies yet. Add one above.
          </div>
        )}
        {companies.map(tc => (
          <div key={tc.id} style={{
            backgroundColor: 'var(--c-card)', border: `1px solid ${tc.is_default ? '#C9A84C' : 'var(--c-border)'}`,
            borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{tc.company_name}</span>
                {tc.is_default && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                    Default
                  </span>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
                {[tc.contact_name, tc.phone, tc.email].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!tc.is_default && (
                <button onClick={() => setDefault(tc)} style={{ padding: '6px 12px', borderRadius: 7, fontSize: 11, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)', cursor: 'pointer' }}>
                  Set Default
                </button>
              )}
              <button onClick={() => startEditTC(tc)} style={{ padding: '6px 12px', borderRadius: 7, fontSize: 11, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)', cursor: 'pointer' }}>
                Edit
              </button>
              <button onClick={() => deleteTC(tc)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 11, backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
