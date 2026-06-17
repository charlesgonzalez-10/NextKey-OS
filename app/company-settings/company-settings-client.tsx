'use client'

import { useState, useEffect } from 'react'

interface Props { role: string }

const S = {
  card: { backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '20px 24px', marginBottom: 12 } as React.CSSProperties,
  label: { fontSize: 12, fontWeight: 600, color: 'var(--c-text-2)', display: 'block', marginBottom: 5, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  input: { width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const },
  sectionLabel: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 14 },
  saveBtn: { padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' } as React.CSSProperties,
  linkCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderRadius: 10, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', textDecoration: 'none', color: 'var(--c-primary)', marginBottom: 8 } as React.CSSProperties,
}

interface CompanyInfo {
  name: string
  brokerage: string
  license: string
  address: string
  city: string
  state: string
  zip: string
  phone: string
  website: string
}

export default function CompanySettingsClient({ role }: Props) {
  const [info, setInfo] = useState<CompanyInfo>({ name: '', brokerage: '', license: '', address: '', city: 'Miami', state: 'FL', zip: '', phone: '', website: '' })
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/user/profile').then(r => r.json()).then(d => {
      if (d.company_name) setInfo(prev => ({ ...prev, name: d.company_name }))
    }).catch(() => {})
    fetch('/api/user/signature').then(r => r.json()).then(d => {
      setInfo(prev => ({
        ...prev,
        name:      d.company_name ?? prev.name,
        phone:     d.company_phone ?? prev.phone,
        website:   d.company_website ?? prev.website,
        brokerage: d.brokerage ?? prev.brokerage,
        license:   d.license_number ?? prev.license,
        address:   d.company_address ?? prev.address,
        city:      d.company_city ?? prev.city,
        state:     d.company_state ?? prev.state,
        zip:       d.company_zip ?? prev.zip,
      }))
    }).catch(() => {})
  }, [])

  const showBanner = (type: 'success' | 'error', msg: string) => {
    setBanner({ type, msg })
    setTimeout(() => setBanner(null), 3500)
  }

  const save = async () => {
    setSaving(true)
    const res = await fetch('/api/user/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name:    info.name,
        company_phone:   info.phone,
        company_website: info.website,
        brokerage:       info.brokerage,
        license_number:  info.license,
        company_address: info.address,
        company_city:    info.city,
        company_state:   info.state,
        company_zip:     info.zip,
      }),
    })
    if (res.ok) showBanner('success', 'Company settings saved.')
    else showBanner('error', 'Failed to save.')
    setSaving(false)
  }

  const isOwner = role === 'owner'

  const quickLinks = [
    { href: '/admin/users', label: 'User Management', desc: 'Invite and manage team members', icon: '👥' },
    { href: '/settings/email-signatures', label: 'Email Signatures', desc: 'Manage reusable signatures for outbound emails', icon: '✍️' },
    { href: '/settings/contract-defaults', label: 'Contract Defaults', desc: 'Set default terms on all contract templates', icon: '📄' },
    { href: '/settings/offer-profiles', label: 'Offer Profiles', desc: 'Save reusable offer structures', icon: '🏷️' },
    { href: '/integrations', label: 'Integrations', desc: 'Manage Gmail, REAPI, and connected services', icon: '🔌' },
    ...(isOwner ? [{ href: '/api-keys', label: 'API Keys', desc: 'View configured API credentials', icon: '🔑' }] : []),
  ]

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', color: 'var(--c-primary)' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Company Settings</h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-2)' }}>Business information used across documents and contracts</p>
      </div>

      {banner && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontSize: 14,
          backgroundColor: banner.type === 'success' ? 'rgba(74,207,154,0.12)' : 'rgba(239,68,68,0.12)',
          color: banner.type === 'success' ? '#4ACF9A' : '#ef4444',
          border: `1px solid ${banner.type === 'success' ? 'rgba(74,207,154,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>{banner.msg}</div>
      )}

      {/* Company Info */}
      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Company Information</p>
        <div style={S.card}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            {[
              { key: 'name',      label: 'Company / Team Name',    placeholder: 'NextKey Property Solutions', span: 2 },
              { key: 'brokerage', label: 'Brokerage',              placeholder: 'EXP Realty'                         },
              { key: 'license',   label: 'License Number',         placeholder: 'BK3456789'                           },
              { key: 'phone',     label: 'Business Phone',         placeholder: '(954) 376-6639'                      },
              { key: 'website',   label: 'Website',                placeholder: 'nextkeyps.com'                       },
            ].map(({ key, label, placeholder, span }) => (
              <div key={key} style={{ gridColumn: span === 2 ? '1 / -1' : undefined }}>
                <label style={S.label}>{label}</label>
                <input style={S.input} value={info[key as keyof CompanyInfo]} onChange={e => setInfo(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} />
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--c-text-2)' }}>Business Address</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div>
                <label style={S.label}>Street Address</label>
                <input style={S.input} value={info.address} onChange={e => setInfo(p => ({ ...p, address: e.target.value }))} placeholder="123 Brickell Ave" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={S.label}>City</label>
                  <input style={S.input} value={info.city} onChange={e => setInfo(p => ({ ...p, city: e.target.value }))} placeholder="Miami" />
                </div>
                <div>
                  <label style={S.label}>State</label>
                  <input style={S.input} value={info.state} onChange={e => setInfo(p => ({ ...p, state: e.target.value }))} placeholder="FL" />
                </div>
                <div>
                  <label style={S.label}>ZIP</label>
                  <input style={S.input} value={info.zip} onChange={e => setInfo(p => ({ ...p, zip: e.target.value }))} placeholder="33131" />
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <button onClick={save} disabled={saving} style={{ ...S.saveBtn, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save Company Info'}
            </button>
          </div>
        </div>
      </section>

      {/* Quick Links */}
      <section>
        <p style={S.sectionLabel}>Team & Configuration</p>
        <div>
          {quickLinks.map(link => (
            <a key={link.href} href={link.href} style={S.linkCard}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--c-hover)'; (e.currentTarget as HTMLElement).style.borderColor = '#C9A84C' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--c-hover)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-border)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{link.icon}</span>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{link.label}</p>
                  <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>{link.desc}</p>
                </div>
              </div>
              <span style={{ color: 'var(--c-text-2)', fontSize: 18, flexShrink: 0 }}>›</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
