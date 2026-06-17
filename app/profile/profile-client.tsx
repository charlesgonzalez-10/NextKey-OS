'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'

const SignaturePad = dynamic(() => import('@/components/SignaturePad'), { ssr: false })

interface Props { userEmail: string }

const S = {
  card: { backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '20px 24px' } as React.CSSProperties,
  label: { fontSize: 12, fontWeight: 600, color: 'var(--c-text-2)', display: 'block', marginBottom: 5, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  input: { width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const },
  sectionLabel: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 14 },
  saveBtn: { padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' } as React.CSSProperties,
}

export default function ProfileClient({ userEmail }: Props) {
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  // Identity fields
  const [identity, setIdentity] = useState({ display_name: '', my_name: '', my_phone: '', my_email: '', company_name: '' })
  const [savingId, setSavingId] = useState(false)

  // Signature
  const [sigData, setSigData] = useState<string | null>(null)
  const [showSigPad, setShowSigPad] = useState(false)

  // Password
  const [pwFields, setPwFields] = useState({ current: '', next: '', confirm: '' })
  const [savingPw, setSavingPw] = useState(false)
  const [pwError, setPwError] = useState('')

  // Role
  const [role, setRole] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/user/profile').then(r => r.json()),
      fetch('/api/user/signature').then(r => r.json()),
    ]).then(([prof, sig]) => {
      setIdentity({
        display_name: prof.display_name ?? '',
        my_name:      sig.my_name      ?? '',
        my_phone:     sig.my_phone     ?? '',
        my_email:     sig.my_email     ?? userEmail,
        company_name: sig.company_name ?? '',
      })
      setSigData(sig.signature_data ?? null)
      setRole(prof.role ?? 'user')
    }).catch(() => {})
  }, [userEmail])

  const showBanner = (type: 'success' | 'error', msg: string) => {
    setBanner({ type, msg })
    setTimeout(() => setBanner(null), 3500)
  }

  const saveIdentity = async () => {
    setSavingId(true)
    const [profRes, sigRes] = await Promise.all([
      fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: identity.display_name || null }),
      }),
      fetch('/api/user/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          my_name:      identity.my_name,
          my_phone:     identity.my_phone,
          my_email:     identity.my_email,
          company_name: identity.company_name,
        }),
      }),
    ])
    if (profRes.ok && sigRes.ok) showBanner('success', 'Profile saved.')
    else showBanner('error', 'Failed to save profile.')
    setSavingId(false)
  }

  const saveSignature = async (dataUrl: string) => {
    const res = await fetch('/api/user/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature_data: dataUrl }),
    })
    if (res.ok) { setSigData(dataUrl); setShowSigPad(false); showBanner('success', 'Signature saved.') }
    else showBanner('error', 'Failed to save signature.')
  }

  const clearSignature = async () => {
    const res = await fetch('/api/user/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature_data: null }),
    })
    if (res.ok) { setSigData(null); showBanner('success', 'Signature cleared.') }
  }

  const changePassword = async () => {
    setPwError('')
    if (!pwFields.current) { setPwError('Current password is required.'); return }
    if (!pwFields.next) { setPwError('New password is required.'); return }
    if (pwFields.next.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    if (pwFields.next !== pwFields.confirm) { setPwError('Passwords do not match.'); return }
    setSavingPw(true)
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    // Verify current password before allowing the change
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: userEmail, password: pwFields.current })
    if (authErr) { setPwError('Current password is incorrect.'); setSavingPw(false); return }
    const { error } = await supabase.auth.updateUser({ password: pwFields.next })
    if (error) showBanner('error', error.message)
    else { showBanner('success', 'Password updated successfully.'); setPwFields({ current: '', next: '', confirm: '' }) }
    setSavingPw(false)
  }

  const roleLabel: Record<string, string> = { owner: 'Owner', admin: 'Admin', user: 'Member', viewer: 'Viewer' }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', color: 'var(--c-primary)' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>My Profile</h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-2)' }}>Personal account settings — visible only to you</p>
      </div>

      {banner && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontSize: 14,
          backgroundColor: banner.type === 'success' ? 'rgba(74,207,154,0.12)' : 'rgba(239,68,68,0.12)',
          color: banner.type === 'success' ? '#4ACF9A' : '#ef4444',
          border: `1px solid ${banner.type === 'success' ? 'rgba(74,207,154,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>{banner.msg}</div>
      )}

      {/* Account Info card */}
      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Account</p>
        <div style={S.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', backgroundColor: 'rgba(201,168,76,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ color: '#C9A84C', fontSize: 18, fontWeight: 700 }}>
                {(identity.display_name || identity.my_name || userEmail).slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 16 }}>{identity.display_name || identity.my_name || 'No name set'}</p>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>{userEmail}</p>
              <span style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {roleLabel[role] ?? role}
              </span>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 16 }}>
            <label style={S.label}>Display Name <span style={{ color: 'var(--c-text-2)', fontWeight: 400, textTransform: 'none' }}>(shown in navigation)</span></label>
            <input style={S.input} value={identity.display_name} onChange={e => setIdentity(p => ({ ...p, display_name: e.target.value }))} placeholder="e.g. Charles" />
          </div>
        </div>
      </section>

      {/* Personal Info */}
      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Personal Information</p>
        <div style={S.card}>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 18 }}>Used to auto-fill your name, phone, email, and company on all contracts and documents.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[
              { key: 'my_name',      label: 'Full Name',         placeholder: 'Charles Gonzalez' },
              { key: 'company_name', label: 'Company / Brokerage', placeholder: 'NextKey Property Solutions' },
              { key: 'my_phone',     label: 'Phone Number',      placeholder: '(954) 376-6639' },
              { key: 'my_email',     label: 'Professional Email', placeholder: userEmail },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label style={S.label}>{label}</label>
                <input
                  style={S.input}
                  value={identity[key as keyof typeof identity]}
                  onChange={e => setIdentity(p => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18 }}>
            <button onClick={saveIdentity} disabled={savingId} style={{ ...S.saveBtn, opacity: savingId ? 0.6 : 1 }}>
              {savingId ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </div>
      </section>

      {/* Signature */}
      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Document Signature</p>
        <div style={S.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>Your Signature</p>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
                {sigData ? 'Saved — embedded into documents when you sign' : 'No signature saved yet'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {sigData && !showSigPad && (
                <button onClick={clearSignature} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>
                  Clear
                </button>
              )}
              <button onClick={() => setShowSigPad(v => !v)} style={{ padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 500, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)', cursor: 'pointer' }}>
                {showSigPad ? 'Cancel' : sigData ? 'Update' : 'Add Signature'}
              </button>
            </div>
          </div>
          {sigData && !showSigPad && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sigData} alt="Saved signature" style={{ maxWidth: 300, maxHeight: 100, border: '1px solid var(--c-border)', borderRadius: 8, backgroundColor: '#fff', padding: 8 }} />
          )}
          {showSigPad && (
            <div style={{ marginTop: 8 }}>
              <SignaturePad onSave={saveSignature} existingDataUrl={null} width={480} height={150} />
            </div>
          )}
        </div>
      </section>

      {/* Password */}
      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Security</p>
        <div style={S.card}>
          <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Change Password</p>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 18 }}>Choose a strong password of at least 8 characters.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
            <div>
              <label style={S.label}>Current Password</label>
              <input type="password" style={S.input} value={pwFields.current} onChange={e => setPwFields(p => ({ ...p, current: e.target.value }))} placeholder="Your current password" />
            </div>
            <div>
              <label style={S.label}>New Password</label>
              <input type="password" style={S.input} value={pwFields.next} onChange={e => setPwFields(p => ({ ...p, next: e.target.value }))} placeholder="At least 8 characters" />
            </div>
            <div>
              <label style={S.label}>Confirm New Password</label>
              <input type="password" style={S.input} value={pwFields.confirm} onChange={e => setPwFields(p => ({ ...p, confirm: e.target.value }))} placeholder="Repeat new password" />
            </div>
          </div>
          {pwError && <p style={{ fontSize: 13, color: '#ef4444', marginTop: 10 }}>{pwError}</p>}
          <div style={{ marginTop: 16 }}>
            <button onClick={changePassword} disabled={savingPw} style={{ ...S.saveBtn, opacity: savingPw ? 0.6 : 1 }}>
              {savingPw ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </div>
      </section>

    </div>
  )
}
