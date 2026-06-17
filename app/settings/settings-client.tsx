'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'

const SignaturePad = dynamic(() => import('@/components/SignaturePad'), { ssr: false })

interface GmailStatus {
  connected: boolean
  email?: string
  expires_at?: string
}

interface UserProfile {
  id: string
  role: 'owner' | 'admin' | 'user' | 'viewer'
  show_admin_tools: boolean
}

export default function SettingsClient() {
  const searchParams = useSearchParams()
  const [gmail, setGmail]         = useState<GmailStatus | null>(null)
  const [loading, setLoading]     = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [banner, setBanner]       = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const [profile, setProfile]         = useState<UserProfile | null>(null)
  const [togglingAdmin, setTogglingAdmin] = useState(false)

  // Signature / identity
  const [sigData, setSigData]         = useState<{
    signature_data: string | null
    my_name: string; my_phone: string; my_email: string; company_name: string
  } | null>(null)
  const [sigFields, setSigFields]     = useState({ my_name: '', my_phone: '', my_email: '', company_name: '' })
  const [savingSig, setSavingSig]     = useState(false)
  const [showSigPad, setShowSigPad]   = useState(false)

  useEffect(() => {
    if (searchParams.get('gmail_connected') === '1') {
      setBanner({ type: 'success', msg: 'Gmail connected successfully.' })
    } else if (searchParams.get('gmail_error')) {
      const err = searchParams.get('gmail_error')!
      setBanner({ type: 'error', msg: `Gmail connection failed: ${err.replace(/_/g, ' ')}` })
    }
  }, [searchParams])

  useEffect(() => {
    fetch('/api/auth/gmail/status')
      .then(r => r.json())
      .then(setGmail)
      .catch(() => setGmail({ connected: false }))
      .finally(() => setLoading(false))

    fetch('/api/user/profile')
      .then(r => r.json())
      .then(setProfile)
      .catch(() => {})

    fetch('/api/user/signature')
      .then(r => r.json())
      .then(d => {
        setSigData(d)
        setSigFields({
          my_name:      d.my_name      ?? '',
          my_phone:     d.my_phone     ?? '',
          my_email:     d.my_email     ?? '',
          company_name: d.company_name ?? '',
        })
      })
      .catch(() => {})
  }, [])

  const saveSignatureSettings = async (newSigDataUrl?: string) => {
    setSavingSig(true)
    const payload: Record<string, string | null> = {
      my_name:      sigFields.my_name,
      my_phone:     sigFields.my_phone,
      my_email:     sigFields.my_email,
      company_name: sigFields.company_name,
    }
    if (newSigDataUrl !== undefined) payload.signature_data = newSigDataUrl
    const res = await fetch('/api/user/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      setBanner({ type: 'success', msg: 'Document identity saved.' })
      setSigData(prev => ({ ...prev!, ...payload, signature_data: newSigDataUrl ?? prev?.signature_data ?? null }))
      setShowSigPad(false)
    } else {
      setBanner({ type: 'error', msg: 'Failed to save.' })
    }
    setSavingSig(false)
    setTimeout(() => setBanner(null), 3000)
  }

  const toggleAdminTools = async () => {
    if (!profile) return
    setTogglingAdmin(true)
    const next = !profile.show_admin_tools
    const res = await fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_admin_tools: next }),
    })
    if (res.ok) {
      const updated = await res.json()
      setProfile(updated)
      setBanner({ type: 'success', msg: `Admin tools ${next ? 'shown in' : 'hidden from'} navigation.` })
    } else {
      setBanner({ type: 'error', msg: 'Failed to update admin tools setting.' })
    }
    setTogglingAdmin(false)
    setTimeout(() => setBanner(null), 3000)
  }

  const disconnect = async () => {
    setDisconnecting(true)
    const res = await fetch('/api/auth/gmail/disconnect', { method: 'POST' })
    if (res.ok) {
      setGmail({ connected: false })
      setBanner({ type: 'success', msg: 'Gmail disconnected.' })
    } else {
      setBanner({ type: 'error', msg: 'Failed to disconnect Gmail.' })
    }
    setDisconnecting(false)
  }

  return (
    <div style={{ color: 'var(--c-primary)', maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

      {banner && (
        <div style={{
          padding: '12px 16px',
          borderRadius: 10,
          marginBottom: 20,
          fontSize: 14,
          backgroundColor: banner.type === 'success' ? 'rgba(74,207,154,0.12)' : 'rgba(239,68,68,0.12)',
          color: banner.type === 'success' ? '#4ACF9A' : '#ef4444',
          border: `1px solid ${banner.type === 'success' ? 'rgba(74,207,154,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>
          {banner.msg}
        </div>
      )}

      {/* Communications section */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 16 }}>
          Communications
        </h2>

        {/* Gmail card */}
        <div style={{
          backgroundColor: 'var(--c-card)',
          border: '1px solid var(--c-border)',
          borderRadius: 14,
          padding: '20px 24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* Gmail logo */}
              <div style={{
                width: 42, height: 42, borderRadius: 10,
                backgroundColor: 'rgba(234,67,53,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="22" height="17" viewBox="0 0 24 18" fill="none">
                  <path d="M22 0H2C0.9 0 0 0.9 0 2V16C0 17.1 0.9 18 2 18H22C23.1 18 24 17.1 24 16V2C24 0.9 23.1 0 22 0Z" fill="#EA4335" fillOpacity="0.15"/>
                  <path d="M12 10.5L0 3V2C0 0.9 0.9 0 2 0H22C23.1 0 24 0.9 24 2V3L12 10.5Z" fill="#EA4335"/>
                  <path d="M0 5L12 12.5L24 5V16C24 17.1 23.1 18 22 18H2C0.9 18 0 17.1 0 16V5Z" fill="#EA4335" fillOpacity="0.7"/>
                </svg>
              </div>
              <div>
                <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>Gmail</p>
                {loading ? (
                  <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Checking status…</p>
                ) : gmail?.connected ? (
                  <p style={{ fontSize: 13, color: '#4ACF9A' }}>Connected — {gmail.email}</p>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Not connected</p>
                )}
              </div>
            </div>

            {!loading && (
              gmail?.connected ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <a
                    href="/api/auth/gmail"
                    style={{
                      padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                      backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)',
                      textDecoration: 'none', whiteSpace: 'nowrap',
                    }}
                  >
                    Reconnect
                  </a>
                  <button
                    onClick={disconnect}
                    disabled={disconnecting}
                    style={{
                      padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                      backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444',
                      border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer',
                      opacity: disconnecting ? 0.5 : 1,
                    }}
                  >
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              ) : (
                <a
                  href="/api/auth/gmail"
                  style={{
                    padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    backgroundColor: '#C9A84C', color: '#0A1F44',
                    textDecoration: 'none', whiteSpace: 'nowrap',
                  }}
                >
                  Connect Gmail
                </a>
              )
            )}
          </div>

          {gmail?.connected && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--c-border)' }}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {['View inbox and sent emails inside NextKey OS', 'Send emails directly from contacts, leads, and deals', 'Attach PDFs (contracts, offers) to outbound emails', 'Track offer statuses (Sent, Accepted, Countered, Rejected)'].map(feat => (
                  <li key={feat} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--c-text-2)' }}>
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="#4ACF9A" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Documents — Identity & Signature */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 16 }}>
          Documents
        </h2>
        <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '20px 24px' }}>
          <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Document Identity</p>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 20 }}>Used to auto-fill your name, phone, email, and company on all documents.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            {[
              { key: 'my_name',      label: 'Your Name',     placeholder: 'Charles Gonzalez' },
              { key: 'company_name', label: 'Company Name',  placeholder: 'NextKey Property Solutions' },
              { key: 'my_phone',     label: 'Phone Number',  placeholder: '(305) 555-0100' },
              { key: 'my_email',     label: 'Email Address', placeholder: 'charles@nextkeyps.com' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 5 }}>{label}</label>
                <input
                  value={sigFields[key as keyof typeof sigFields]}
                  onChange={e => setSigFields(p => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
                    border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)',
                    color: 'var(--c-primary)', boxSizing: 'border-box' as const,
                  }}
                />
              </div>
            ))}
          </div>

          {/* Saved signature preview */}
          <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 18, marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Signature</p>
                <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
                  {sigData?.signature_data ? 'Saved — will be used when signing documents' : 'No signature saved yet'}
                </p>
              </div>
              <button
                onClick={() => setShowSigPad(v => !v)}
                style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                  backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)',
                  border: '1px solid var(--c-border)', cursor: 'pointer',
                }}
              >
                {showSigPad ? 'Close' : sigData?.signature_data ? 'Update Signature' : 'Add Signature'}
              </button>
            </div>
            {sigData?.signature_data && !showSigPad && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sigData.signature_data}
                alt="Saved signature"
                style={{ maxWidth: 280, maxHeight: 90, border: '1px solid var(--c-border)', borderRadius: 8, backgroundColor: '#fff', padding: 8 }}
              />
            )}
            {showSigPad && (
              <div style={{ marginTop: 12 }}>
                <SignaturePad
                  onSave={url => saveSignatureSettings(url)}
                  existingDataUrl={null}
                  width={480}
                  height={150}
                />
              </div>
            )}
          </div>

          <button
            onClick={() => saveSignatureSettings()}
            disabled={savingSig}
            style={{
              padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              backgroundColor: '#C9A84C', color: '#0A1F44',
              border: 'none', cursor: savingSig ? 'wait' : 'pointer',
              opacity: savingSig ? 0.7 : 1,
            }}
          >
            {savingSig ? 'Saving…' : 'Save Identity'}
          </button>
        </div>
      </section>

      {/* Admin Tools toggle — only shown to owner/admin */}
      {profile && (profile.role === 'owner' || profile.role === 'admin') && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 16 }}>
            Admin
          </h2>
          <div style={{
            backgroundColor: 'var(--c-card)',
            border: '1px solid var(--c-border)',
            borderRadius: 14,
            padding: '20px 24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Show Admin Tools</p>
                <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
                  {profile.show_admin_tools
                    ? 'Admin Dashboard is visible in navigation.'
                    : 'Admin Dashboard is hidden from navigation. You can still access it directly at /admin.'}
                </p>
              </div>
              <button
                onClick={toggleAdminTools}
                disabled={togglingAdmin}
                style={{
                  position: 'relative', width: 48, height: 26, borderRadius: 13,
                  backgroundColor: profile.show_admin_tools ? '#C9A84C' : 'var(--c-hover)',
                  border: '1px solid var(--c-border)',
                  cursor: togglingAdmin ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.2s', flexShrink: 0,
                  opacity: togglingAdmin ? 0.6 : 1,
                }}
                aria-label="Toggle admin tools"
              >
                <span style={{
                  position: 'absolute', top: 3,
                  left: profile.show_admin_tools ? 24 : 3,
                  width: 18, height: 18, borderRadius: '50%',
                  backgroundColor: '#fff',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </button>
            </div>

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--c-border)', display: 'flex', gap: 12 }}>
              <a
                href="/admin"
                style={{
                  fontSize: 13, fontWeight: 500, color: 'var(--c-primary)',
                  textDecoration: 'none', padding: '7px 16px',
                  backgroundColor: 'var(--c-hover)', borderRadius: 8,
                  border: '1px solid var(--c-border)',
                }}
              >
                Open Admin Dashboard
              </a>
              {profile.role === 'owner' && (
                <a
                  href="/admin/users"
                  style={{
                    fontSize: 13, fontWeight: 500, color: 'var(--c-text-2)',
                    textDecoration: 'none', padding: '7px 16px',
                    backgroundColor: 'var(--c-hover)', borderRadius: 8,
                    border: '1px solid var(--c-border)',
                  }}
                >
                  Manage Users
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Email & Signatures */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 16 }}>
          Email &amp; Signatures
        </h2>
        <a
          href="/settings/email-signatures"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '18px 24px', textDecoration: 'none', color: 'var(--c-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <div>
            <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>Email Signatures</p>
            <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Create and manage multiple email signatures — Personal, Investor, Realtor. Set one as default.</p>
          </div>
          <svg width="16" height="16" fill="none" stroke="var(--c-text-2)" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </a>
      </section>

      {/* Contract Defaults */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 16 }}>
          Contracts &amp; Offers
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <a
            href="/settings/contract-defaults"
            style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '18px 24px', textDecoration: 'none', color: 'var(--c-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <div>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>Contract Defaults</p>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Company info, transaction defaults, and title companies — auto-filled on every contract.</p>
            </div>
            <svg width="16" height="16" fill="none" stroke="var(--c-text-2)" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
          <a
            href="/settings/offer-profiles"
            style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '18px 24px', textDecoration: 'none', color: 'var(--c-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <div>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>Offer Profiles</p>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Wholesale, Retail, Airbnb — save buyer names, timelines, and clauses per deal type.</p>
            </div>
            <svg width="16" height="16" fill="none" stroke="var(--c-text-2)" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </section>

      {/* Coming soon section */}
      <section>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 16 }}>
          Coming Soon
        </h2>
        <div style={{
          backgroundColor: 'var(--c-card)',
          border: '1px solid var(--c-border)',
          borderRadius: 14,
          padding: '16px 24px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {[
            { name: 'Twilio SMS', note: 'A2P approval pending' },
            { name: 'Outlook / Microsoft 365', note: 'Not yet available' },
            { name: 'WhatsApp Business', note: 'Not yet available' },
          ].map(item => (
            <div key={item.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{item.name}</span>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)',
              }}>
                {item.note}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
