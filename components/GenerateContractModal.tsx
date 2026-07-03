'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { buildAutoFill, variableLabel } from '@/lib/documents/template-utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Template {
  id: string
  name: string
  category: string
  description: string | null
  // text templates
  variables?: string[]
  is_builtin?: boolean
  // pdf templates
  field_mappings?: unknown[] | null
  // discriminator
  type: 'text' | 'pdf'
}

interface PropertyResult {
  id: string
  property_address: string
  owner_name?: string
  county?: string
  city?: string
  zip?: string
  folio_number?: string
  lead_id?: string
}

interface ContactResult {
  id: string
  name: string
  phone?: string
  email?: string
  category?: string
}

interface DealResult {
  id: string
  address: string
  status: string
  offer_price?: number
}

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

interface OfferRow {
  id: string
  purchase_price: number
  earnest_money?: number | null
  financing_type?: string | null
  closing_days?: number | null
  inspection_days?: number | null
  offer_pct?: number | null
}

interface Props {
  onClose: () => void
  defaultLeadId?: string
  defaultPropertyId?: string
  defaultContactId?: string
  defaultDealId?: string
}

type Step = 'template' | 'property' | 'contact' | 'deal' | 'profile' | 'review'

const STEP_LABELS: Record<Step, string> = {
  template: 'Template',
  property: 'Property',
  contact:  'Contact',
  deal:     'Deal',
  profile:  'Offer Profile',
  review:   'Review & Generate',
}
const STEPS: Step[] = ['template', 'property', 'contact', 'deal', 'profile', 'review']

const CATEGORY_LABEL: Record<string, string> = {
  offer: 'Offer', loi: 'LOI', assignment: 'Assignment', contract: 'Contract',
  disclosure: 'Disclosure', letter: 'Letter', other: 'Other',
}
const CATEGORY_COLORS: Record<string, string> = {
  offer: '#C9A84C', loi: '#818cf8', assignment: '#38bdf8',
  contract: '#4ACF9A', disclosure: '#f472b6', letter: '#fb923c', other: '#888',
}

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
  border: '1px solid var(--c-input-border)', backgroundColor: 'var(--c-input-bg)',
  color: 'var(--c-primary)', boxSizing: 'border-box',
}

const searchInp: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 14,
  border: '1px solid var(--c-input-border)', backgroundColor: 'var(--c-input-bg)',
  color: 'var(--c-primary)', boxSizing: 'border-box', outline: 'none',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GenerateContractModal({
  onClose,
  defaultLeadId,
  defaultPropertyId,
  defaultContactId,
  defaultDealId,
}: Props) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('template')

  // Multi-select templates
  const [selectedTemplates, setSelectedTemplates] = useState<Template[]>([])

  const [selectedProperty, setSelectedProperty] = useState<PropertyResult | null>(null)
  const [selectedContact,  setSelectedContact]  = useState<ContactResult | null>(null)
  const [selectedDeal,     setSelectedDeal]     = useState<DealResult | null>(null)
  const [selectedProfile,  setSelectedProfile]  = useState<OfferProfile | null>(null)
  const [latestOffer,      setLatestOffer]      = useState<OfferRow | null>(null)

  // Logged-in user's profile (default buyer)
  const [userProfile, setUserProfile] = useState<{ name: string; email: string; phone: string } | null>(null)
  const [overridingBuyer, setOverridingBuyer] = useState(false)

  // Data lists
  const [templates,     setTemplates]     = useState<Template[]>([])
  const [offerProfiles, setOfferProfiles] = useState<OfferProfile[]>([])

  // Search state
  const [propSearch,     setPropSearch]     = useState('')
  const [propResults,    setPropResults]    = useState<PropertyResult[]>([])
  const [propLoading,    setPropLoading]    = useState(false)
  const [contactSearch,  setContactSearch]  = useState('')
  const [contactResults, setContactResults] = useState<ContactResult[]>([])
  const [contactLoading, setContactLoading] = useState(false)
  const [dealSearch,     setDealSearch]     = useState('')
  const [dealResults,    setDealResults]    = useState<DealResult[]>([])
  const [dealLoading,    setDealLoading]    = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')

  // Review step fields (text templates only)
  const [fields,          setFields]         = useState<Record<string, string>>({})
  const [docName,         setDocName]        = useState('')
  const [recipientEmail,  setRecipientEmail] = useState('')
  const [generating,      setGenerating]     = useState(false)
  const [error,           setError]          = useState<string | null>(null)

  const hasTextTemplate = selectedTemplates.some(t => t.type === 'text')
  const hasPdfTemplate  = selectedTemplates.some(t => t.type === 'pdf')

  // ── Load initial data ────────────────────────────────────────────────────────
  useEffect(() => {
    // Fetch both text templates and PDF contract templates in parallel
    Promise.all([
      fetch('/api/document-templates').then(r => r.json()).catch(() => []),
      fetch('/api/contract-templates').then(r => r.json()).catch(() => ({ templates: [] })),
    ]).then(([textRaw, pdfRaw]) => {
      const textTemplates: Template[] = (Array.isArray(textRaw) ? textRaw : [])
        .map((t: Template) => ({ ...t, type: 'text' as const }))
      const pdfTemplates: Template[] = (Array.isArray(pdfRaw) ? pdfRaw : [])
        .filter((t: Template) => t.field_mappings && (t.field_mappings as unknown[]).length > 0)
        .map((t: Template) => ({ ...t, type: 'pdf' as const }))
      setTemplates([...pdfTemplates, ...textTemplates])
    })

    // Load logged-in user's profile for default buyer
    fetch('/api/user/signature').then(r => r.json()).then(d => {
      if (d?.my_name) setUserProfile({ name: d.my_name, email: d.my_email ?? '', phone: d.my_phone ?? '' })
    }).catch(() => {})

    fetch('/api/offer-profiles').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : []
      setOfferProfiles(list)
      const def = list.find((p: OfferProfile) => p.is_default)
      if (def) setSelectedProfile(def)
    }).catch(() => {})

    if (defaultPropertyId) {
      // Use the single-property endpoint (SELECT *) — the list API ignores the id param
      fetch(`/api/properties/${defaultPropertyId}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.id) setSelectedProperty(d) })
        .catch(() => {})
    }
  }, [defaultPropertyId, defaultContactId])

  // ── Auto-load latest offer when property changes ─────────────────────────────
  useEffect(() => {
    if (!selectedProperty) { setLatestOffer(null); return }
    fetch(`/api/offers?property_id=${selectedProperty.id}&latest=true`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { offer: OfferRow | null } | null) => { setLatestOffer(d?.offer ?? null) })
      .catch(() => {})
  }, [selectedProperty])

  // ── Search handlers ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (propSearch.length < 2) { setPropResults([]); return }
    setPropLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/properties?search=${encodeURIComponent(propSearch)}&limit=8`)
        .then(r => r.json())
        .then(d => setPropResults(d.properties ?? []))
        .catch(() => {})
        .finally(() => setPropLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [propSearch])

  useEffect(() => {
    if (contactSearch.length < 2) { setContactResults([]); return }
    setContactLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/contacts/search?q=${encodeURIComponent(contactSearch)}&limit=8`)
        .then(r => r.json())
        .then(d => setContactResults(d.contacts ?? []))
        .catch(() => {})
        .finally(() => setContactLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [contactSearch])

  useEffect(() => {
    if (step !== 'deal') return
    const q = dealSearch.length >= 2 ? encodeURIComponent(dealSearch) : ''
    const cParam = selectedContact ? `&contact_id=${selectedContact.id}` : ''
    setDealLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/deals?q=${q}&limit=8${cParam}`)
        .then(r => r.json())
        .then(d => setDealResults(d.deals ?? []))
        .catch(() => {})
        .finally(() => setDealLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [dealSearch, step, selectedContact])

  // ── Auto-fill on entering review step (text templates only) ─────────────────
  const buildFields = useCallback(async () => {
    const textTemplate = selectedTemplates.find(t => t.type === 'text')
    if (!textTemplate) return

    const [csRes, tcRes, sigRes] = await Promise.allSettled([
      fetch('/api/contract-settings').then(r => r.json()),
      fetch('/api/title-companies').then(r => r.json()),
      fetch('/api/user/signature').then(r => r.json()),
    ])

    const cs  = csRes.status  === 'fulfilled' ? csRes.value  : {}
    const tcs = tcRes.status  === 'fulfilled' ? tcRes.value  : []
    const sig = sigRes.status === 'fulfilled' ? sigRes.value : {}

    const defaultTC = Array.isArray(tcs) ? tcs.find((t: { is_default: boolean }) => t.is_default) ?? tcs[0] ?? null : null

    const auto = buildAutoFill({
      user:             sig,
      property:         selectedProperty ? (selectedProperty as unknown as Record<string, unknown>) : undefined,
      contact:          selectedContact  ? (selectedContact  as unknown as Record<string, unknown>) : undefined,
      deal:             selectedDeal     ? (selectedDeal     as unknown as Record<string, unknown>) : undefined,
      offer:            latestOffer      ? (latestOffer      as unknown as Record<string, unknown>) : undefined,
      contractSettings: cs,
      titleCompany:     defaultTC,
      offerProfile:     selectedProfile  ? (selectedProfile  as unknown as Record<string, unknown>) : undefined,
    })

    const filled: Record<string, string> = {}
    for (const v of (textTemplate.variables ?? [])) {
      filled[v] = auto[v] ?? ''
    }
    setFields(filled)

    const firstName = selectedTemplates[0]?.name ?? ''
    setDocName(
      firstName +
      (selectedProperty ? ' — ' + selectedProperty.property_address : '') +
      (selectedContact  ? ' / ' + selectedContact.name : '')
    )
    setRecipientEmail(selectedContact?.email ?? '')
  }, [selectedTemplates, selectedProperty, selectedContact, selectedDeal, selectedProfile])

  useEffect(() => {
    if (step === 'review') buildFields()
  }, [step, buildFields])

  // ── Navigation ───────────────────────────────────────────────────────────────
  const currentIdx = STEPS.indexOf(step)
  const goNext = () => {
    if (step === 'template' && selectedTemplates.length === 0) return
    const next = STEPS[currentIdx + 1]
    if (next) setStep(next)
  }
  const goPrev = () => {
    const prev = STEPS[currentIdx - 1]
    if (prev) setStep(prev)
  }

  // ── Template toggle ──────────────────────────────────────────────────────────
  const toggleTemplate = (t: Template) => {
    setSelectedTemplates(prev => {
      const exists = prev.find(s => s.id === t.id)
      return exists ? prev.filter(s => s.id !== t.id) : [...prev, t]
    })
  }

  // ── Generate ─────────────────────────────────────────────────────────────────
  const generate = async () => {
    if (selectedTemplates.length === 0) return
    setGenerating(true)
    setError(null)

    try {
      const pdfTemplates  = selectedTemplates.filter(t => t.type === 'pdf')
      const textTemplates = selectedTemplates.filter(t => t.type === 'text')

      // Generate all PDF templates — save as document records for e-signature flow
      const docIds: string[] = []
      for (const tmpl of pdfTemplates) {
        const res = await fetch(`/api/contract-templates/${tmpl.id}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact_id:        selectedContact?.id ?? defaultContactId ?? null,
            lead_id:           selectedProperty?.id ?? defaultLeadId   ?? null,
            deal_id:           selectedDeal?.id     ?? defaultDealId   ?? null,
            offer_id:          latestOffer?.id      ?? null,
            save_as_document:  true,
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(`${tmpl.name}: ${err.error ?? 'Generation failed'}`)
        }
        const doc = await res.json()
        docIds.push(doc.id)
      }

      onClose()

      // Route to signing wizard with the first document pre-loaded
      // Additional documents can be added inside the wizard
      if (docIds.length > 0) {
        const params = new URLSearchParams({ document_id: docIds[0] })
        if (docIds.length > 1) docIds.slice(1).forEach(id => params.append('also', id))
        router.push(`/sign-sessions/new?${params.toString()}`)
        return
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  // ─── Render helpers ──────────────────────────────────────────────────────────

  const selCard = (
    label: string,
    value: string | null,
    sub?: string,
    onClear?: () => void,
  ) => (
    value ? (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderRadius: 10, backgroundColor: 'rgba(201,168,76,0.12)',
        border: '1px solid rgba(201,168,76,0.5)', marginBottom: 16,
      }}>
        <div>
          <p style={{ fontSize: 11, color: '#C9A84C', fontWeight: 600, marginBottom: 2 }}>{label}</p>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-primary)' }}>{value}</p>
          {sub && <p style={{ fontSize: 12, color: 'var(--c-text-1)' }}>{sub}</p>}
        </div>
        {onClear && (
          <button onClick={onClear} style={{ background: 'none', border: 'none', color: 'var(--c-text-1)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        )}
      </div>
    ) : null
  )

  const resultItem = (
    primary: string,
    secondary: string,
    onClick: () => void,
    selected: boolean,
  ) => (
    <button
      key={primary}
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', padding: '12px 16px', borderRadius: 10,
        border: `1px solid ${selected ? 'rgba(201,168,76,0.6)' : 'var(--c-border-strong)'}`,
        backgroundColor: selected ? 'rgba(201,168,76,0.12)' : 'var(--c-card)',
        cursor: 'pointer', marginBottom: 8,
      }}
    >
      <p style={{ fontSize: 14, fontWeight: selected ? 700 : 500, color: 'var(--c-primary)', marginBottom: 2 }}>{primary}</p>
      <p style={{ fontSize: 12, color: 'var(--c-text-1)' }}>{secondary}</p>
    </button>
  )

  // ─── Steps ───────────────────────────────────────────────────────────────────

  const filteredTemplates = templates.filter(t =>
    !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(templateSearch.toLowerCase()) ||
    (t.category ?? '').toLowerCase().includes(templateSearch.toLowerCase())
  )

  const renderTemplate = () => (
    <div>
      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-primary)', marginBottom: 4 }}>Select Contract Template(s)</p>
      <p style={{ fontSize: 13, color: 'var(--c-text-1)', marginBottom: 16 }}>
        Check one or more templates to generate at once — e.g. FAR/BAR As Is + Lead Based Paint Disclosure.
      </p>

      {selectedTemplates.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {selectedTemplates.map(t => (
            <span
              key={t.id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C',
                border: '1px solid rgba(201,168,76,0.3)',
              }}
            >
              {t.name}
              <button
                onClick={() => toggleTemplate(t)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C9A84C', fontSize: 14, lineHeight: 1, padding: 0 }}
              >×</button>
            </span>
          ))}
        </div>
      )}

      <input
        value={templateSearch}
        onChange={e => setTemplateSearch(e.target.value)}
        placeholder="Search templates…"
        style={{ ...searchInp, marginBottom: 12 }}
      />

      {templates.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--c-text-1)', padding: '16px 0', textAlign: 'center' }}>
          No templates found.{' '}
          <a href="/documents/templates" style={{ color: '#C9A84C' }}>
            Build one in Templates →
          </a>
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredTemplates.map(t => {
          const isChecked = selectedTemplates.some(s => s.id === t.id)
          const color = CATEGORY_COLORS[t.category] ?? '#888'
          return (
            <button
              key={t.id}
              onClick={() => toggleTemplate(t)}
              style={{
                textAlign: 'left', padding: '14px 18px', borderRadius: 12,
                border: `1px solid ${isChecked ? 'rgba(201,168,76,0.6)' : 'var(--c-border-strong)'}`,
                backgroundColor: isChecked ? 'rgba(201,168,76,0.12)' : 'var(--c-card)',
                cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 14,
              }}
            >
              {/* Checkbox */}
              <div style={{
                width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 2,
                border: `2px solid ${isChecked ? '#C9A84C' : 'rgba(255,255,255,0.25)'}`,
                backgroundColor: isChecked ? '#C9A84C' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isChecked && <span style={{ color: '#0A1F44', fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: isChecked ? 700 : 600, fontSize: 14, color: 'var(--c-primary)' }}>
                    {t.name}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                    backgroundColor: `${color}20`, color,
                  }}>
                    {CATEGORY_LABEL[t.category] ?? t.category}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5,
                    backgroundColor: t.type === 'pdf' ? 'rgba(74,207,154,0.12)' : 'rgba(129,140,248,0.12)',
                    color: t.type === 'pdf' ? '#4ACF9A' : '#818cf8',
                  }}>
                    {t.type === 'pdf' ? 'PDF' : 'Text'}
                  </span>
                  {t.is_builtin && (
                    <span style={{ fontSize: 10, color: 'var(--c-text-1)', padding: '2px 6px', borderRadius: 5, backgroundColor: 'var(--c-hover)' }}>
                      Built-in
                    </span>
                  )}
                </div>
                {t.description && <p style={{ fontSize: 12, color: 'var(--c-text-1)' }}>{t.description}</p>}
                <p style={{ fontSize: 11, color: 'var(--c-text-1)', marginTop: 4 }}>
                  {t.type === 'pdf'
                    ? `${(t.field_mappings as unknown[])?.length ?? 0} mapped fields — downloads as PDF`
                    : `${Array.isArray(t.variables) ? t.variables.length : 0} auto-fill fields`
                  }
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )

  const renderProperty = () => (
    <div>
      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-primary)', marginBottom: 4 }}>Select Property</p>
      <p style={{ fontSize: 13, color: 'var(--c-text-1)', marginBottom: 16 }}>Search for the subject property to pull address, county, and parcel data.</p>
      {selCard('Selected Property', selectedProperty?.property_address ?? null, [selectedProperty?.county, selectedProperty?.city].filter(Boolean).join(', '), () => setSelectedProperty(null))}
      <input
        value={propSearch}
        onChange={e => setPropSearch(e.target.value)}
        placeholder="Search by address or owner name…"
        style={searchInp}
      />
      <div style={{ marginTop: 12 }}>
        {propLoading && <p style={{ fontSize: 13, color: 'var(--c-text-1)', padding: '8px 0' }}>Searching…</p>}
        {propResults.map(p => resultItem(
          p.property_address,
          [p.owner_name, p.county, p.folio_number].filter(Boolean).join(' · '),
          () => { setSelectedProperty(p); setPropSearch('') },
          selectedProperty?.id === p.id,
        ))}
        {propSearch.length >= 2 && !propLoading && propResults.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--c-text-1)', padding: '8px 0' }}>No results found.</p>
        )}
      </div>
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--c-border)' }}>
        <button onClick={() => setStep('contact')} style={{ fontSize: 13, color: 'var(--c-text-1)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Skip — no property to link →
        </button>
      </div>
    </div>
  )

  const renderContact = () => {
    const showSearch = overridingBuyer || !userProfile || selectedContact !== null
    return (
      <div>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-primary)', marginBottom: 4 }}>Buyer</p>
        <p style={{ fontSize: 13, color: 'var(--c-text-1)', marginBottom: 16 }}>
          Defaults to your profile. Override only if someone else is the buyer.
        </p>

        {/* Explicit contact override card */}
        {selectedContact && selCard(
          'Buyer (Override)',
          selectedContact.name,
          [selectedContact.phone, selectedContact.email, selectedContact.category].filter(Boolean).join(' · '),
          () => { setSelectedContact(null); setOverridingBuyer(false); setContactSearch('') },
        )}

        {/* Default: account user as buyer */}
        {!selectedContact && userProfile && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderRadius: 10,
            backgroundColor: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.5)',
            marginBottom: 16,
          }}>
            <div>
              <p style={{ fontSize: 11, color: '#C9A84C', fontWeight: 600, marginBottom: 2 }}>Buyer — You (Account Default)</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-primary)' }}>{userProfile.name}</p>
              {(userProfile.phone || userProfile.email) && (
                <p style={{ fontSize: 12, color: 'var(--c-text-1)' }}>
                  {[userProfile.phone, userProfile.email].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            {!overridingBuyer && (
              <button
                onClick={() => setOverridingBuyer(true)}
                style={{ fontSize: 12, color: '#C9A84C', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', whiteSpace: 'nowrap' }}
              >
                Change
              </button>
            )}
          </div>
        )}

        {/* Search input — shown when overriding or no profile loaded */}
        {showSearch && !selectedContact && (
          <>
            <input
              value={contactSearch}
              onChange={e => setContactSearch(e.target.value)}
              placeholder="Search buyer by name, phone, or email…"
              style={searchInp}
              autoFocus
            />
            <div style={{ marginTop: 12 }}>
              {contactLoading && <p style={{ fontSize: 13, color: 'var(--c-text-1)', padding: '8px 0' }}>Searching…</p>}
              {contactResults.map(c => resultItem(
                c.name,
                [c.phone, c.email, c.category].filter(Boolean).join(' · '),
                () => { setSelectedContact(c); setContactSearch(''); setOverridingBuyer(false) },
                false,
              ))}
              {contactSearch.length >= 2 && !contactLoading && contactResults.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--c-text-1)', padding: '8px 0' }}>No contacts found.</p>
              )}
            </div>
          </>
        )}

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--c-border)' }}>
          <button onClick={() => setStep('deal')} style={{ fontSize: 13, color: 'var(--c-text-1)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Continue without linking a buyer →
          </button>
        </div>
      </div>
    )
  }

  const renderDeal = () => (
    <div>
      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-primary)', marginBottom: 4 }}>Link a Deal <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--c-text-1)' }}>(optional)</span></p>
      <p style={{ fontSize: 13, color: 'var(--c-text-1)', marginBottom: 16 }}>Linking a deal pulls offer price, closing date, and EMD into the contract.</p>
      {selCard('Selected Deal', selectedDeal?.address ?? null, selectedDeal ? `${selectedDeal.status}${selectedDeal.offer_price ? ' · $' + Number(selectedDeal.offer_price).toLocaleString() : ''}` : undefined, () => setSelectedDeal(null))}
      <input
        value={dealSearch}
        onChange={e => setDealSearch(e.target.value)}
        placeholder="Search by address…"
        style={searchInp}
      />
      <div style={{ marginTop: 12 }}>
        {dealLoading && <p style={{ fontSize: 13, color: 'var(--c-text-1)', padding: '8px 0' }}>Searching…</p>}
        {dealResults.map(d => resultItem(
          d.address,
          [d.status, d.offer_price ? '$' + Number(d.offer_price).toLocaleString() : null].filter(Boolean).join(' · '),
          () => { setSelectedDeal(d); setDealSearch('') },
          selectedDeal?.id === d.id,
        ))}
        {dealResults.length === 0 && !dealLoading && (
          <p style={{ fontSize: 13, color: 'var(--c-text-1)', padding: '8px 0' }}>
            {dealSearch.length >= 2 ? 'No deals found.' : 'Start typing to search deals…'}
          </p>
        )}
      </div>
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--c-border)' }}>
        <button onClick={() => setStep('profile')} style={{ fontSize: 13, color: 'var(--c-text-1)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Skip — no deal to link →
        </button>
      </div>
    </div>
  )

  const renderProfile = () => (
    <div>
      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-primary)', marginBottom: 4 }}>Select Offer Profile</p>
      <p style={{ fontSize: 13, color: 'var(--c-text-1)', marginBottom: 20 }}>Profiles set the buyer name, timelines, and EMD for a specific deal type.</p>

      <button
        onClick={() => setSelectedProfile(null)}
        style={{
          width: '100%', textAlign: 'left', padding: '12px 16px', borderRadius: 10, marginBottom: 8,
          border: `1px solid ${selectedProfile === null ? 'rgba(201,168,76,0.6)' : 'var(--c-border-strong)'}`,
          backgroundColor: selectedProfile === null ? 'rgba(201,168,76,0.12)' : 'var(--c-card)',
          cursor: 'pointer',
        }}
      >
        <p style={{ fontSize: 14, fontWeight: selectedProfile === null ? 600 : 500, color: 'var(--c-primary)' }}>
          No profile — use contract defaults only
        </p>
      </button>

      {offerProfiles.map(p => (
        <button
          key={p.id}
          onClick={() => setSelectedProfile(p)}
          style={{
            width: '100%', textAlign: 'left', padding: '14px 18px', borderRadius: 10, marginBottom: 8,
            border: `1px solid ${selectedProfile?.id === p.id ? 'rgba(201,168,76,0.6)' : 'var(--c-border-strong)'}`,
            backgroundColor: selectedProfile?.id === p.id ? 'rgba(201,168,76,0.12)' : 'var(--c-card)',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: selectedProfile?.id === p.id ? 700 : 600, fontSize: 14, color: 'var(--c-primary)' }}>
              {p.name}
            </span>
            {p.is_default && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>Default</span>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'var(--c-text-1)' }}>
            {[
              p.buyer_name && `Buyer: ${p.buyer_name}`,
              p.closing_days && `${p.closing_days}d close`,
              p.inspection_days && `${p.inspection_days}d inspection`,
              p.earnest_money && `$${Number(p.earnest_money).toLocaleString()} EMD`,
            ].filter(Boolean).join(' · ') || 'No overrides set'}
          </p>
        </button>
      ))}

      {offerProfiles.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--c-text-1)', marginTop: 8 }}>
          No profiles yet.{' '}
          <a href="/settings/offer-profiles" target="_blank" style={{ color: '#C9A84C' }}>
            Create one in Settings →
          </a>
        </p>
      )}
    </div>
  )

  const renderReview = () => (
    <div>
      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-primary)', marginBottom: 4 }}>Review &amp; Generate</p>
      <p style={{ fontSize: 13, color: 'var(--c-text-1)', marginBottom: 20 }}>
        {hasPdfTemplate && !hasTextTemplate
          ? 'PDF templates will download automatically with fields pre-filled.'
          : 'All fields have been auto-filled. Edit anything before generating.'}
      </p>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {[
          selectedTemplates.length > 0 && { label: 'Templates', val: selectedTemplates.map(t => t.name).join(', ') },
          selectedProperty && { label: 'Property', val: selectedProperty.property_address },
          { label: 'Buyer', val: selectedContact?.name ?? userProfile?.name ?? 'Account user' },
          selectedDeal     && { label: 'Deal',      val: selectedDeal.address + (selectedDeal.offer_price ? ` · $${Number(selectedDeal.offer_price).toLocaleString()}` : '') },
          selectedProfile  && { label: 'Profile',   val: selectedProfile.name },
        ].filter(Boolean).map((item) => {
          const it = item as { label: string; val: string }
          return (
            <div key={it.label} style={{ padding: '10px 14px', borderRadius: 9, backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
              <p style={{ fontSize: 10, color: 'var(--c-text-1)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 3 }}>{it.label}</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-primary)' }}>{it.val}</p>
            </div>
          )
        })}
      </div>

      {/* PDF templates — will save and go to signing */}
      {hasPdfTemplate && (
        <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, backgroundColor: 'rgba(74,207,154,0.08)', border: '1px solid rgba(74,207,154,0.25)' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#4ACF9A', marginBottom: 6 }}>Will fill and open for e-signature:</p>
          {selectedTemplates.filter(t => t.type === 'pdf').map(t => (
            <p key={t.id} style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-primary)' }}>✍ {t.name}</p>
          ))}
          <p style={{ fontSize: 11, color: 'var(--c-text-1)', marginTop: 6 }}>You&apos;ll place signature fields and send to all parties from the next screen.</p>
        </div>
      )}

      {/* Text template fields */}
      {hasTextTemplate && (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--c-text-1)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Document Name</label>
            <input value={docName} onChange={e => setDocName(e.target.value)} style={inp} placeholder="Contract name…" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, color: 'var(--c-text-1)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Recipient Email (optional)</label>
            <input value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} style={inp} placeholder="seller@email.com" type="email" />
          </div>

          {Object.keys(fields).length > 0 && (
            <>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--c-text-1)', marginBottom: 12 }}>
                Auto-Filled Contract Fields
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {Object.entries(fields).map(([key, val]) => (
                  <div key={key}>
                    <label style={{ fontSize: 11, color: 'var(--c-text-1)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      {variableLabel(key)}
                    </label>
                    <input
                      value={val}
                      onChange={e => setFields(p => ({ ...p, [key]: e.target.value }))}
                      style={{ ...inp, fontSize: 12 }}
                      placeholder={`{{${key}}}`}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 13, border: '1px solid rgba(239,68,68,0.3)' }}>
          {error}
        </div>
      )}
    </div>
  )

  // ─── Layout ───────────────────────────────────────────────────────────────────

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 680, maxHeight: '90vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        backgroundColor: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', borderBottom: '1px solid var(--c-border)', paddingBottom: 16, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 18, color: 'var(--c-primary)' }}>Generate Contract</p>
              <p style={{ fontSize: 13, color: 'var(--c-text-1)' }}>Auto-fill from your records — ready in under 60 seconds</p>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ×
            </button>
          </div>
          {/* Step indicators */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {STEPS.map((s, i) => (
              <button
                key={s}
                onClick={() => { if (i <= currentIdx) setStep(s) }}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  whiteSpace: 'nowrap', cursor: i <= currentIdx ? 'pointer' : 'default',
                  backgroundColor: s === step ? '#C9A84C' : i < currentIdx ? 'rgba(201,168,76,0.15)' : 'var(--c-card)',
                  border: s === step || i < currentIdx ? 'none' : '1px solid var(--c-border-strong)',
                  color: s === step ? '#0A1F44' : i < currentIdx ? '#C9A84C' : 'var(--c-text-1)',
                }}
              >
                {i + 1}. {STEP_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {step === 'template' && renderTemplate()}
          {step === 'property' && renderProperty()}
          {step === 'contact'  && renderContact()}
          {step === 'deal'     && renderDeal()}
          {step === 'profile'  && renderProfile()}
          {step === 'review'   && renderReview()}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <button
            onClick={goPrev}
            disabled={currentIdx === 0}
            style={{
              padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500,
              backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)',
              border: '1px solid var(--c-border)', cursor: currentIdx === 0 ? 'default' : 'pointer',
              opacity: currentIdx === 0 ? 0.4 : 1,
            }}
          >
            ← Back
          </button>

          {step !== 'review' ? (
            <button
              onClick={goNext}
              disabled={step === 'template' && selectedTemplates.length === 0}
              style={{
                padding: '9px 24px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none',
                cursor: (step === 'template' && selectedTemplates.length === 0) ? 'default' : 'pointer',
                opacity: (step === 'template' && selectedTemplates.length === 0) ? 0.5 : 1,
              }}
            >
              Next →{selectedTemplates.length > 0 && step === 'template' ? ` (${selectedTemplates.length} selected)` : ''}
            </button>
          ) : (
            <button
              onClick={generate}
              disabled={generating}
              style={{
                padding: '10px 28px', borderRadius: 8, fontSize: 14, fontWeight: 700,
                backgroundColor: generating ? 'var(--c-hover)' : '#C9A84C',
                color: generating ? 'var(--c-text-2)' : '#0A1F44',
                border: 'none', cursor: generating ? 'wait' : 'pointer',
              }}
            >
              {generating ? 'Generating…' : `Generate & Sign${selectedTemplates.length > 1 ? ` (${selectedTemplates.length})` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
