'use client'

import { useState, useEffect } from 'react'

interface AppUser {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  role: 'owner' | 'admin' | 'user' | 'viewer'
  show_admin_tools: boolean
  display_name: string | null
}

const ROLE_COLORS: Record<string, string> = {
  owner:  'rgba(201,168,76,0.2)',
  admin:  'rgba(99,102,241,0.2)',
  user:   'rgba(255,255,255,0.08)',
  viewer: 'rgba(255,255,255,0.08)',
}
const ROLE_TEXT: Record<string, string> = {
  owner:  '#C9A84C',
  admin:  '#818cf8',
  user:   'rgba(255,255,255,0.5)',
  viewer: 'rgba(255,255,255,0.4)',
}

export default function UsersClient() {
  const [users, setUsers]     = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState<string | null>(null)
  const [banner, setBanner]   = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  // Invite modal state
  const [showInvite,   setShowInvite]   = useState(false)
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviteRole,   setInviteRole]   = useState<'user' | 'admin' | 'viewer'>('user')
  const [inviting,     setInviting]     = useState(false)
  const [credentials,  setCredentials]  = useState<{ email: string; password: string } | null>(null)

  useEffect(() => {
    fetch('/api/admin/users')
      .then(r => r.json())
      .then(d => setUsers(d.users ?? []))
      .catch(() => setBanner({ type: 'error', msg: 'Failed to load users.' }))
      .finally(() => setLoading(false))
  }, [])

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    })
    const data = await res.json()
    if (res.ok) {
      setCredentials({ email: inviteEmail, password: data.tempPassword })
      setInviteEmail('')
      setInviteRole('user')
      fetch('/api/admin/users').then(r => r.json()).then(d => setUsers(d.users ?? []))
    } else {
      setBanner({ type: 'error', msg: data.error ?? 'Failed to create user.' })
      setShowInvite(false)
      setTimeout(() => setBanner(null), 5000)
    }
    setInviting(false)
  }

  const changeRole = async (userId: string, role: string) => {
    setSaving(userId)
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (res.ok) {
      const updated = await res.json()
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: updated.role } : u))
      setBanner({ type: 'success', msg: 'Role updated.' })
    } else {
      const err = await res.json()
      setBanner({ type: 'error', msg: err.error ?? 'Failed to update role.' })
    }
    setSaving(null)
    setTimeout(() => setBanner(null), 3000)
  }

  return (
    <div style={{ color: 'var(--c-primary)', maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>

      {/* Credentials display after creation */}
      {credentials && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Account Created</h2>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Share these login credentials with your user. They can change their password after signing in via My Profile.</p>
            </div>
            <div style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Website</p>
                <p style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>nextkeyos.vercel.app</p>
              </div>
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Email</p>
                <p style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>{credentials.email}</p>
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Temporary Password</p>
                <p style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: '#C9A84C', letterSpacing: '0.05em' }}>{credentials.password}</p>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginBottom: 20, textAlign: 'center' }}>
              Screenshot or copy this before closing — the password won't be shown again.
            </p>
            <button
              onClick={() => { setCredentials(null); setShowInvite(false) }}
              style={{ width: '100%', padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && !credentials && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowInvite(false) }}>
          <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 420 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>Add a User</h2>
              <button onClick={() => setShowInvite(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-2)', fontSize: 22, lineHeight: 1 }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 20, lineHeight: 1.5 }}>
              A temporary password will be generated. Share it directly with the user — no email required.
            </p>
            <form onSubmit={sendInvite}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-2)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email Address</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="dad@email.com"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-2)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Role</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as 'user' | 'admin' | 'viewer')}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box', cursor: 'pointer' }}
                >
                  <option value="viewer">Viewer — read-only access</option>
                  <option value="user">User — standard features</option>
                  <option value="admin">Admin — admin dashboard + all features</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowInvite(false)} style={{ padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={inviting} style={{ padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', opacity: inviting ? 0.6 : 1 }}>
                  {inviting ? 'Creating…' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>User Management</h1>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Assign roles and manage access. Only the owner can change roles.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowInvite(true)}
            style={{ fontSize: 13, fontWeight: 600, color: '#0A1F44', backgroundColor: '#C9A84C', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}
          >
            + Invite User
          </button>
          <a
            href="/admin"
            style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-2)', textDecoration: 'none', padding: '8px 14px', border: '1px solid var(--c-border)', borderRadius: 8 }}
          >
            ← Admin
          </a>
        </div>
      </div>

      {banner && (
        <div style={{
          padding: '11px 16px', borderRadius: 10, marginBottom: 20, fontSize: 13,
          backgroundColor: banner.type === 'success' ? 'rgba(74,207,154,0.12)' : 'rgba(239,68,68,0.12)',
          color: banner.type === 'success' ? '#4ACF9A' : '#ef4444',
          border: `1px solid ${banner.type === 'success' ? 'rgba(74,207,154,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>
          {banner.msg}
        </div>
      )}

      {/* Role legend */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20,
      }}>
        {[
          { role: 'owner',  desc: 'Full access, cannot be changed' },
          { role: 'admin',  desc: 'Admin dashboard + all features' },
          { role: 'user',   desc: 'Standard features' },
          { role: 'viewer', desc: 'Read-only access' },
        ].map(({ role, desc }) => (
          <div key={role} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', borderRadius: 8,
            backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)',
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
              backgroundColor: ROLE_COLORS[role], color: ROLE_TEXT[role],
              textTransform: 'capitalize',
            }}>{role}</span>
            <span style={{ fontSize: 12, color: 'var(--c-text-2)' }}>{desc}</span>
          </div>
        ))}
      </div>

      <div style={{
        backgroundColor: 'var(--c-card)',
        border: '1px solid var(--c-border)',
        borderRadius: 14,
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-text-2)', fontSize: 14 }}>
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-text-2)', fontSize: 14 }}>
            No users found.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                {['User', 'Current Role', 'Last Sign In', 'Change Role'].map(h => (
                  <th key={h} style={{
                    padding: '12px 20px', textAlign: 'left',
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                    color: 'var(--c-text-2)', textTransform: 'uppercase',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id} style={{
                  borderBottom: i < users.length - 1 ? '1px solid var(--c-border)' : 'none',
                }}>
                  <td style={{ padding: '14px 20px' }}>
                    <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
                      {u.display_name ?? u.email?.split('@')[0]}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>{u.email}</p>
                  </td>
                  <td style={{ padding: '14px 20px' }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
                      backgroundColor: ROLE_COLORS[u.role], color: ROLE_TEXT[u.role],
                      textTransform: 'capitalize',
                    }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--c-text-2)' }}>
                    {u.last_sign_in_at
                      ? new Date(u.last_sign_in_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : 'Never'}
                  </td>
                  <td style={{ padding: '14px 20px' }}>
                    {u.role === 'owner' ? (
                      <span style={{ fontSize: 12, color: 'var(--c-text-2)' }}>Protected</span>
                    ) : (
                      <select
                        value={u.role}
                        disabled={saving === u.id}
                        onChange={e => changeRole(u.id, e.target.value)}
                        style={{
                          padding: '6px 10px', borderRadius: 8, fontSize: 13,
                          backgroundColor: 'var(--c-hover)', color: 'var(--c-primary)',
                          border: '1px solid var(--c-border)', cursor: 'pointer',
                          opacity: saving === u.id ? 0.5 : 1,
                        }}
                      >
                        <option value="admin">admin</option>
                        <option value="user">user</option>
                        <option value="viewer">viewer</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
