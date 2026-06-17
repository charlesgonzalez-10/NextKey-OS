'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import { fmtDate } from '@/lib/acquisitionEngine'

const RELATIONSHIP_TYPES = [
  'Owner', 'Co-owner', 'Heir', 'Spouse',
  'Attorney', 'Agent', 'Lender',
  'Buyer', 'Seller', 'Title Company', 'Other',
]

interface SearchContact {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  category?: string | null
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--c-card)',
  border: '1px solid var(--c-border)',
  borderRadius: '16px',
  overflow: 'hidden',
  marginBottom: '12px',
}

export default function PeopleTab() {
  const { lead, contacts, setActiveTab, refreshContacts } = useWorkspace()
  const propertyId = lead.id

  const [panel, setPanel]             = useState<'none' | 'link' | 'create'>('none')

  // Link-existing state
  const [searchQ, setSearchQ]         = useState('')
  const [searchRes, setSearchRes]     = useState<SearchContact[]>([])
  const [searching, setSearching]     = useState(false)
  const [linkRelType, setLinkRelType] = useState('Owner')
  const [linkPrimary, setLinkPrimary] = useState(false)

  // Create-new state
  const [form, setForm] = useState({
    name: '', phone: '', email: '', address: '',
    relationship_type: 'Owner', is_primary: false,
  })

  // Shared action state
  const [saving, setSaving]     = useState(false)
  const [saveErr, setSaveErr]   = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  // Debounced contact search
  useEffect(() => {
    if (!searchQ.trim()) { setSearchRes([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(searchQ)}`)
        const data = await res.json()
        setSearchRes(data.contacts ?? [])
      } catch { /* ignore */ }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ])

  const closePanel = useCallback(() => {
    setPanel('none')
    setSaveErr(null)
    setSearchQ('')
    setSearchRes([])
    setLinkRelType('Owner')
    setLinkPrimary(false)
    setForm({ name: '', phone: '', email: '', address: '', relationship_type: 'Owner', is_primary: false })
  }, [])

  const linkExisting = async (contactId: string) => {
    setSaving(true); setSaveErr(null)
    try {
      const res = await fetch(`/api/leads/${propertyId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, relationship_type: linkRelType, is_primary: linkPrimary }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveErr(data.error ?? 'Failed'); return }
      await refreshContacts()
      closePanel()
    } catch (e) { setSaveErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  const createAndLink = async () => {
    if (!form.name.trim()) { setSaveErr('Name is required'); return }
    setSaving(true); setSaveErr(null)
    try {
      const res = await fetch(`/api/leads/${propertyId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
          relationship_type: form.relationship_type,
          is_primary: form.is_primary,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveErr(data.error ?? 'Failed'); return }
      await refreshContacts()
      closePanel()
    } catch (e) { setSaveErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  const handleImportOwner = async () => {
    if (!lead.owner_name?.trim()) return
    setImporting(true); setActionErr(null)
    try {
      const res = await fetch(`/api/leads/${propertyId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: lead.owner_name, relationship_type: 'Owner', is_primary: true }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed')
      }
      await refreshContacts()
    } catch (e) { setActionErr(e instanceof Error ? e.message : 'Error') }
    finally { setImporting(false) }
  }

  const makePrimary = async (contactId: string) => {
    setActionErr(null)
    try {
      const res = await fetch(`/api/leads/${propertyId}/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_primary: true }),
      })
      if (!res.ok) throw new Error('Failed to set primary')
      await refreshContacts()
    } catch (e) { setActionErr(e instanceof Error ? e.message : 'Error') }
  }

  const removeContact = async (contactId: string) => {
    setActionErr(null)
    try {
      const res = await fetch(`/api/leads/${propertyId}/contacts/${contactId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove')
      await refreshContacts()
    } catch (e) { setActionErr(e instanceof Error ? e.message : 'Error') }
  }

  const updateRelType = async (contactId: string, rel: string) => {
    setActionErr(null)
    try {
      await fetch(`/api/leads/${propertyId}/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relationship_type: rel }),
      })
      await refreshContacts()
    } catch { /* silent */ }
  }

  // PA-enriched phones
  const paPhones = [lead.phone_1, lead.phone_2, lead.phone_3, lead.phone_4, lead.phone_5].filter(Boolean) as string[]

  const ownerAlreadyImported = contacts.some(c => c.relationship_type === 'Owner' && c.contact.name === lead.owner_name)

  return (
    <div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold" style={{ color: 'var(--c-primary)' }}>People</h3>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
            Owners, attorneys, heirs, and other parties linked to this lead
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setSaveErr(null); setPanel(p => p === 'link' ? 'none' : 'link') }}
            className="text-[11px] font-bold px-3 py-1.5 rounded-xl hover:opacity-80 transition-opacity flex items-center gap-1.5"
            style={{ backgroundColor: 'rgba(76,175,154,0.15)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.35)' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
            </svg>
            Link Existing
          </button>
          <button
            onClick={() => { setSaveErr(null); setPanel(p => p === 'create' ? 'none' : 'create') }}
            className="text-[11px] font-bold px-3 py-1.5 rounded-xl hover:opacity-80 transition-opacity"
            style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
            + New Contact
          </button>
        </div>
      </div>

      {/* ── Owner on Record ─────────────────────────────────────────────────── */}
      {(lead.owner_name || paPhones.length > 0) && (
        <div style={{ ...cardStyle, marginBottom: '16px' }}>
          <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Owner on Record</p>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold" style={{ color: 'var(--c-primary)' }}>
                  {lead.owner_name ?? <span style={{ color: 'var(--c-text-3)' }}>Unknown Owner</span>}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                  {lead.county && (
                    <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>County: <span style={{ color: 'var(--c-text-2)' }}>{lead.county}</span></span>
                  )}
                  {lead.folio_number && (
                    <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Folio: <span style={{ color: 'var(--c-text-2)', fontFamily: 'monospace' }}>{lead.folio_number}</span></span>
                  )}
                </div>
                {paPhones.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    {paPhones.map((ph, i) => (
                      <a key={i} href={`tel:${ph}`}
                        className="text-[11px] font-semibold flex items-center gap-1 px-2.5 py-1 rounded-lg hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: 'rgba(76,175,154,0.1)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.25)' }}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        {ph}
                        {i > 0 && <span className="text-[9px] opacity-60">#{i + 1}</span>}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {lead.owner_name && !ownerAlreadyImported && (
                <button
                  onClick={handleImportOwner}
                  disabled={importing}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-xl hover:opacity-80 shrink-0"
                  style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
                  {importing ? 'Importing…' : 'Import as Contact →'}
                </button>
              )}
              {ownerAlreadyImported && (
                <span className="text-[11px] font-semibold shrink-0" style={{ color: '#22c55e' }}>✓ Imported</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Link Existing Panel ─────────────────────────────────────────────── */}
      {panel === 'link' && (
        <div style={{ ...cardStyle, marginBottom: '16px', border: '1px solid rgba(76,175,154,0.3)' }}>
          <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'rgba(76,175,154,0.05)' }}>
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#4CAF9A' }}>Link Existing Contact</p>
          </div>
          <div className="p-4 space-y-3">
            <input
              autoFocus
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search by name, phone, or email…"
              className="w-full px-3 py-2 text-sm rounded-xl focus:outline-none"
              style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
            />
            {searching && (
              <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Searching…</p>
            )}
            {searchRes.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {searchRes.map(c => (
                  <div key={c.id}
                    className="flex items-center justify-between px-3 py-2 rounded-xl hover:opacity-80 cursor-pointer"
                    style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)' }}
                    onClick={() => linkExisting(c.id)}>
                    <div>
                      <p className="text-[12px] font-semibold" style={{ color: 'var(--c-primary)' }}>{c.name}</p>
                      <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                        {[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact info'}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold" style={{ color: '#4CAF9A' }}>
                      {saving ? '…' : 'Link →'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {searchQ.trim() && !searching && searchRes.length === 0 && (
              <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                No contacts found — try "+ New Contact" to create one.
              </p>
            )}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: 'var(--c-text-3)' }}>Relationship</label>
                <select
                  value={linkRelType}
                  onChange={e => setLinkRelType(e.target.value)}
                  className="w-full text-sm px-2 py-1.5 rounded-lg focus:outline-none"
                  style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                  {RELATIONSHIP_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] font-semibold mt-4 cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
                <input type="checkbox" checked={linkPrimary} onChange={e => setLinkPrimary(e.target.checked)}
                  style={{ accentColor: '#C9A84C' }} />
                Primary
              </label>
            </div>
            {saveErr && <p className="text-[11px]" style={{ color: '#ef4444' }}>{saveErr}</p>}
            <div className="flex justify-end">
              <button onClick={closePanel}
                className="text-[11px] px-3 py-1.5 rounded-xl hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create New Contact Panel ────────────────────────────────────────── */}
      {panel === 'create' && (
        <div style={{ ...cardStyle, marginBottom: '16px', border: '1px solid rgba(201,168,76,0.3)' }}>
          <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'rgba(201,168,76,0.05)' }}>
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#C9A84C' }}>Create & Link New Contact</p>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {[
              { label: 'Full Name *', key: 'name',    ph: 'John Smith',           col: 'col-span-2' },
              { label: 'Phone',       key: 'phone',   ph: '(954) 555-1234',       col: '' },
              { label: 'Email',       key: 'email',   ph: 'john@example.com',     col: '' },
              { label: 'Address',     key: 'address', ph: '123 Main St, City FL', col: 'col-span-2' },
            ].map(({ label, key, ph, col }) => (
              <div key={key} className={col}>
                <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: 'var(--c-text-3)' }}>{label}</label>
                <input
                  type="text"
                  value={form[key as keyof typeof form] as string}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={ph}
                  className="w-full px-3 py-2 text-sm rounded-xl focus:outline-none"
                  style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
                />
              </div>
            ))}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: 'var(--c-text-3)' }}>Relationship</label>
              <select
                value={form.relationship_type}
                onChange={e => setForm(f => ({ ...f, relationship_type: e.target.value }))}
                className="w-full text-sm px-2 py-1.5 rounded-lg focus:outline-none"
                style={{ backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}>
                {RELATIONSHIP_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
                <input type="checkbox" checked={form.is_primary} onChange={e => setForm(f => ({ ...f, is_primary: e.target.checked }))}
                  style={{ accentColor: '#C9A84C' }} />
                Mark as primary contact
              </label>
            </div>
            {saveErr && <p className="text-[11px] col-span-2" style={{ color: '#ef4444' }}>{saveErr}</p>}
            <div className="col-span-2 flex gap-2 pt-1">
              <button onClick={createAndLink} disabled={saving || !form.name.trim()}
                className="flex-1 py-2 text-sm font-bold rounded-xl hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
                {saving ? 'Saving…' : 'Create & Link'}
              </button>
              <button onClick={closePanel}
                className="px-4 py-2 text-sm rounded-xl hover:opacity-80"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {actionErr && (
        <p className="text-[11px] mb-3" style={{ color: '#ef4444' }}>{actionErr}</p>
      )}

      {/* ── Contacts List ───────────────────────────────────────────────────── */}
      {contacts.length === 0 ? (
        <div className="text-center py-10" style={{ border: '1px dashed var(--c-border)', borderRadius: '16px' }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2"
            style={{ backgroundColor: 'var(--c-hover)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
            </svg>
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>No contacts linked yet</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>
            {lead.owner_name ? `Import ${lead.owner_name} or add a new contact above` : 'Add a new contact or link an existing one above'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {contacts.map(lc => (
            <div key={lc.contact.id} style={cardStyle}>
              {/* Contact header */}
              <div className="flex items-start justify-between px-4 pt-3 pb-2.5">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
                    style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                    {lc.contact.name?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold" style={{ color: 'var(--c-primary)' }}>{lc.contact.name}</span>
                      {lc.is_primary && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.4)' }}>
                          PRIMARY
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <select
                        value={lc.relationship_type}
                        onChange={e => updateRelType(lc.contact.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full focus:outline-none"
                        style={{ backgroundColor: 'rgba(107,159,212,0.12)', color: '#6B9FD4', border: '1px solid rgba(107,159,212,0.3)', cursor: 'pointer' }}>
                        {RELATIONSHIP_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {!lc.is_primary && (
                    <button onClick={() => makePrimary(lc.contact.id)}
                      className="text-[10px] font-semibold px-2 py-1 rounded-lg hover:opacity-80"
                      style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
                      title="Make primary contact">
                      ★ Primary
                    </button>
                  )}
                  <a href={`/contacts/${lc.contact.id}`}
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'var(--c-hover)', color: '#6B9FD4', border: '1px solid var(--c-border)' }}>
                    View →
                  </a>
                  <button onClick={() => removeContact(lc.contact.id)}
                    className="text-[10px] px-2 py-1 rounded-lg hover:opacity-80"
                    style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}
                    title="Remove from this lead">
                    ✕
                  </button>
                </div>
              </div>

              {/* Contact info */}
              {(lc.contact.phone || lc.contact.email || lc.contact.address) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3">
                  {lc.contact.phone && (
                    <a href={`tel:${lc.contact.phone}`}
                      className="text-[11px] font-semibold flex items-center gap-1 hover:opacity-80"
                      style={{ color: '#4CAF9A' }}>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      {lc.contact.phone}
                    </a>
                  )}
                  {lc.contact.email && (
                    <a href={`mailto:${lc.contact.email}`}
                      className="text-[11px] font-semibold hover:opacity-80"
                      style={{ color: '#6B9FD4' }}>
                      {lc.contact.email}
                    </a>
                  )}
                  {lc.contact.address && (
                    <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                      {lc.contact.address}
                    </span>
                  )}
                </div>
              )}

              {/* Quick actions + added date */}
              <div className="flex items-center justify-between px-4 pb-3">
                <div className="flex gap-1.5">
                  {lc.contact.phone && (
                    <a href={`tel:${lc.contact.phone}`}
                      className="text-[10px] font-semibold px-2.5 py-1 rounded-lg hover:opacity-80 flex items-center gap-1"
                      style={{ backgroundColor: 'rgba(76,175,154,0.1)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.25)' }}>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      Call
                    </a>
                  )}
                  <button onClick={() => setActiveTab('comms')}
                    className="text-[10px] font-semibold px-2.5 py-1 rounded-lg hover:opacity-80 flex items-center gap-1"
                    style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    Message
                  </button>
                </div>
                <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                  Added {fmtDate(lc.created_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
