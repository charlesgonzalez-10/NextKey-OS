'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  computeAcquisitionState,
  STAGE_META,
  type AcquisitionState,
  type TabId,
  type WorkspaceAISummary,
  type WorkspaceContact,
  type WorkspaceComp,
  type WorkspaceDeal,
  type WorkspaceDocument,
  type WorkspaceLead,
  type WorkspaceNote,
} from '@/lib/acquisitionEngine'
import AcquisitionSidebar from '@/components/workspace/AcquisitionSidebar'

// ── Lazy-load heavy tabs ──────────────────────────────────────────────────────
const OverviewTab              = dynamic(() => import('@/components/workspace/tabs/OverviewTab'))
const PeopleTab                = dynamic(() => import('@/components/workspace/tabs/PeopleTab'))
const ContactIntelligenceTab   = dynamic(() => import('@/components/workspace/tabs/ContactIntelligenceTab'))
const AnalyzeTab               = dynamic(() => import('@/components/workspace/tabs/AnalyzeTab'))
const OfferTab                 = dynamic(() => import('@/components/workspace/tabs/OfferTab'))
const WorkspaceDocsTab         = dynamic(() => import('@/components/workspace/tabs/WorkspaceDocsTab'))
const CommunicationsTab        = dynamic(() => import('@/components/workspace/tabs/CommunicationsTab'))
const CloseTab                 = dynamic(() => import('@/components/workspace/tabs/CloseTab'))
const ListingTab               = dynamic(() => import('@/components/workspace/tabs/ListingTab'))
const CompsTab                 = dynamic(() => import('@/components/workspace/tabs/CompsTab'))

// ── Types ─────────────────────────────────────────────────────────────────────

export type LeadTypeDef = { id: string; name: string; color: string }

// ── Context ───────────────────────────────────────────────────────────────────

interface WorkspaceCtx {
  lead: WorkspaceLead
  notes: WorkspaceNote[]
  documents: WorkspaceDocument[]
  contacts: WorkspaceContact[]
  deals: WorkspaceDeal[]
  comps: WorkspaceComp[]
  aiSummary: WorkspaceAISummary | null
  acquisition: AcquisitionState
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  refreshNotes: () => Promise<void>
  refreshDocuments: () => Promise<void>
  refreshContacts: () => Promise<void>
  addNote: (body: string, noteType?: string) => Promise<void>
  updateLeadField: (fields: Record<string, unknown>) => Promise<void>
  patchLeadLocal: (fields: Partial<WorkspaceLead>) => void
  isSaving: boolean
  // Enrichment
  onEnrich: (force?: boolean) => Promise<void>
  onDeepEnrich: () => Promise<void>
  enriching: boolean
  deepEnriching: boolean
  enrichMsg: string
  deepEnrichMsg: string
  // Classification
  leadTypes: LeadTypeDef[]
  verticals: LeadTypeDef[]
}

const WorkspaceContext = createContext<WorkspaceCtx | null>(null)

export function useWorkspace(): WorkspaceCtx {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be inside WorkspaceClient')
  return ctx
}

// ── Tab config ────────────────────────────────────────────────────────────────

const BASE_TABS: { id: TabId; label: string }[] = [
  { id: 'overview',    label: 'Overview' },
  { id: 'people',      label: 'People' },
  { id: 'contact',     label: 'Contact Intelligence' },
  { id: 'analyze',     label: 'Analyze' },
  { id: 'offer',       label: 'Offer' },
  { id: 'documents',   label: 'Documents' },
  { id: 'comms',       label: 'Communications' },
  { id: 'close',       label: 'Close' },
  { id: 'comps',       label: 'Comps' },
]

const COUNTY_LABELS: Record<string, string> = {
  'miami-dade': 'Miami-Dade',
  'broward':    'Broward',
  'palm-beach': 'Palm Beach',
}

const EQUITY_COLORS: Record<string, string> = {
  'High':      '#4CAF9A',
  'Medium':    '#C9A84C',
  'Low':       '#E07B6A',
  'Negative':  '#ef4444',
}

function daysSince(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface WorkspaceClientProps {
  lead: WorkspaceLead
  aiSummary: WorkspaceAISummary | null
  notes: WorkspaceNote[]
  comps: WorkspaceComp[]
  documents: WorkspaceDocument[]
  contacts: WorkspaceContact[]
  deals: WorkspaceDeal[]
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WorkspaceClient(props: WorkspaceClientProps) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const propertyId   = pathname.split('/leads/')[1]

  // ── Mutable workspace data ──
  const [notes,     setNotes]     = useState<WorkspaceNote[]>(props.notes)
  const [documents, setDocuments] = useState<WorkspaceDocument[]>(props.documents)
  const [contacts,  setContacts]  = useState<WorkspaceContact[]>(props.contacts)
  const [lead,      setLead]      = useState<WorkspaceLead>(props.lead)
  const [isSaving,  setIsSaving]  = useState(false)

  // ── Enrichment state ──
  const [enriching,      setEnriching]      = useState(false)
  const [enrichMsg,      setEnrichMsg]      = useState('')
  const [deepEnriching,  setDeepEnriching]  = useState(false)
  const [deepEnrichMsg,  setDeepEnrichMsg]  = useState('')

  // ── Classification ──
  const [leadTypes, setLeadTypes] = useState<LeadTypeDef[]>([])
  const [verticals, setVerticals] = useState<LeadTypeDef[]>([])

  // ── Tabs (Listing tab shown conditionally when lead has MLS data) ──
  const TABS = useMemo(() => {
    const hasListing = !!(props.lead.mls_status || props.lead.mls_active || props.lead.mls_listing_price)
    if (hasListing) return [...BASE_TABS, { id: 'listing' as TabId, label: 'Listing' }]
    return BASE_TABS
  }, [props.lead.mls_status, props.lead.mls_active, props.lead.mls_listing_price])

  // ── Tab state ── (URL param: ?tab=overview)
  const rawTab = searchParams.get('tab') as TabId | null
  const activeTab: TabId = TABS.some(t => t.id === rawTab) ? rawTab! : 'overview'

  const setActiveTab = useCallback((tab: TabId) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname, searchParams])

  // ── Acquisition engine ──
  const acquisition = useMemo(() => computeAcquisitionState({
    lead,
    notes,
    documents,
    contacts,
    deals: props.deals,
    aiSummary: props.aiSummary,
    comps: props.comps,
  }), [lead, notes, documents, contacts, props.deals, props.aiSummary, props.comps])

  // ── Data refresh helpers ──
  const refreshNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${propertyId}/notes`)
      if (res.ok) {
        const data = await res.json()
        setNotes(Array.isArray(data) ? data : data.notes ?? [])
      }
    } catch { /* silent */ }
  }, [propertyId])

  const refreshDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents?property_id=${propertyId}`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(Array.isArray(data) ? data : [])
      }
    } catch { /* silent */ }
  }, [propertyId])

  const refreshContacts = useCallback(async () => {
    try {
      const res = await fetch(`/api/properties/${propertyId}/contacts`)
      if (res.ok) {
        const data = await res.json()
        setContacts(data.contacts ?? [])
      }
    } catch { /* silent */ }
  }, [propertyId])

  const addNote = useCallback(async (body: string, noteType = 'note') => {
    const res = await fetch(`/api/leads/${propertyId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, note_type: noteType }),
    })
    if (res.ok) {
      const newNote = await res.json()
      setNotes(prev => [newNote, ...prev])
    }
  }, [propertyId])

  const patchLeadLocal = useCallback((fields: Partial<WorkspaceLead>) => {
    setLead(prev => ({ ...prev, ...fields }))
  }, [])

  const updateLeadField = useCallback(async (fields: Record<string, unknown>) => {
    setIsSaving(true)
    setLead(prev => ({ ...prev, ...fields }))
    try {
      await fetch(`/api/leads/${propertyId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
    } catch { /* silent */ }
    finally { setIsSaving(false) }
  }, [propertyId])

  // ── Enrichment functions ──
  const onEnrich = useCallback(async (force = false) => {
    setEnriching(true)
    setEnrichMsg('')
    try {
      const res = await fetch(`/api/leads/${propertyId}/enrich${force ? '?force=true' : ''}`, { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.lead) {
        setLead(prev => ({ ...prev, ...data.lead }))
        setEnrichMsg(`✓ ${data.fields_updated?.length ?? 0} fields updated from ${COUNTY_LABELS[data.lead.county ?? ''] ?? 'Property Appraiser'}`)
      } else if (data.skipped) {
        setEnrichMsg('Already up to date')
      } else {
        setEnrichMsg(data.error ?? 'Enrichment failed')
      }
    } catch {
      setEnrichMsg('Enrichment request failed')
    }
    setEnriching(false)
    setTimeout(() => setEnrichMsg(''), 5000)
  }, [propertyId])

  const onDeepEnrich = useCallback(async () => {
    const pid = lead.property_id ?? lead.id
    if (!pid) return
    setDeepEnriching(true)
    setDeepEnrichMsg('')
    try {
      const res = await fetch(`/api/properties/deep-enrich/${pid}`, { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.result) {
        setLead(prev => ({ ...prev, ...data.updated, enrichment_src: 'reapi' }))
        setDeepEnrichMsg(`✓ ${data.fields_updated?.length ?? 0} fields from RealEstateAPI`)
      } else {
        setDeepEnrichMsg(data.error ?? 'Deep enrich failed')
      }
    } catch {
      setDeepEnrichMsg('Deep enrich request failed')
    }
    setDeepEnriching(false)
    setTimeout(() => setDeepEnrichMsg(''), 6000)
  }, [lead.property_id, lead.id])

  // ── Starred toggle ──
  const toggleStar = useCallback(async () => {
    await updateLeadField({ starred: !lead.starred })
  }, [lead.starred, updateLeadField])

  // ── Load lead types + verticals + auto-enrich ──
  useEffect(() => {
    Promise.all([
      fetch('/api/lead-types').then(r => r.ok ? r.json() : []),
      fetch('/api/business-verticals').then(r => r.ok ? r.json() : []),
    ]).then(([types, verts]) => {
      setLeadTypes((types as (LeadTypeDef & { is_active?: boolean })[]).filter(t => t.is_active !== false))
      setVerticals((verts as (LeadTypeDef & { is_active?: boolean })[]).filter(v => v.is_active !== false))
    }).catch(() => {})

    // Auto-enrich Miami-Dade leads silently on first open
    if (props.lead.county === 'miami-dade' && !props.lead.enriched_at) {
      fetch(`/api/leads/${propertyId}/enrich`, { method: 'POST' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.lead) setLead(prev => ({ ...prev, ...data.lead }))
        })
        .catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Derived display values ──
  const stage    = lead.pipeline_stage ?? ''
  const stageMeta = STAGE_META[stage] ?? null
  const ds        = daysSince(lead.file_date)
  const eClr      = EQUITY_COLORS[lead.equity_tier ?? ''] ?? '#9ca3af'
  const phones    = [lead.phone_1, lead.phone_2, lead.phone_3, lead.phone_4, lead.phone_5].filter(Boolean) as string[]
  const currentLeadType = leadTypes.find(t => t.id === lead.lead_type_id)
  const currentVertical = verticals.find(v => v.id === lead.vertical_id)

  const ctx: WorkspaceCtx = {
    lead, notes, documents, contacts,
    deals: props.deals, comps: props.comps, aiSummary: props.aiSummary,
    acquisition, activeTab, setActiveTab,
    refreshNotes, refreshDocuments, refreshContacts,
    addNote, updateLeadField, patchLeadLocal, isSaving,
    onEnrich, onDeepEnrich, enriching, deepEnriching, enrichMsg, deepEnrichMsg,
    leadTypes, verticals,
  }

  return (
    <WorkspaceContext.Provider value={ctx}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#060e1a', color: '#e2e8f0', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>

        {/* ── Top bar ── */}
        <div style={{ background: '#0a1729', borderBottom: '1px solid #1a3050', flexShrink: 0 }}>

          {/* Row 1: back + address + classifiers + star + offer button */}
          <div style={{ padding: '8px 20px 6px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => router.push('/leads')}
              style={{ color: '#4a6a9a', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              ← Leads
            </button>
            <span style={{ color: '#1a3050', flexShrink: 0 }}>|</span>

            {/* Address */}
            <div style={{ minWidth: 0, flex: '1 1 200px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}>
                  {lead.property_address}
                </span>
                <span style={{ color: '#4a6a9a', fontWeight: 400, fontSize: '12px' }}>
                  {[lead.city, lead.state, lead.zip].filter(Boolean).join(', ')}
                </span>
              </div>
              {/* Stats strip */}
              <div style={{ fontSize: '11px', color: '#4a6a9a', marginTop: '2px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {(lead.market_value ?? lead.estimated_value) && (
                  <span style={{ color: '#C9A84C', fontWeight: 500 }}>
                    ${Math.round((lead.market_value ?? lead.estimated_value ?? 0) / 1000)}k
                  </span>
                )}
                {lead.equity_dollar_amount && (
                  <span style={{ color: eClr, fontWeight: 500 }}>
                    ${Math.round(lead.equity_dollar_amount / 1000)}k equity
                  </span>
                )}
                {lead.beds && <span>{lead.beds}/{lead.baths ?? '?'} bd/ba</span>}
                {(lead.sqft ?? lead.living_area) && (
                  <span>{Number(lead.sqft ?? lead.living_area).toLocaleString()} sqft</span>
                )}
                {lead.year_built && <span>{lead.year_built}</span>}
                {lead.owner_name && <span>· {lead.owner_name}</span>}
              </div>
            </div>

            <div style={{ flex: 1 }} />

            {/* Lead Type selector */}
            {leadTypes.length > 0 && (
              <select
                value={lead.lead_type_id ?? ''}
                onChange={e => updateLeadField({ lead_type_id: e.target.value || null })}
                style={{ fontSize: '11px', fontWeight: 500, padding: '3px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.07)', color: currentLeadType ? currentLeadType.color : '#4a6a9a', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', outline: 'none' }}
              >
                <option value="">Lead Type</option>
                {leadTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}

            {/* Vertical selector */}
            {verticals.length > 0 && (
              <select
                value={lead.vertical_id ?? ''}
                onChange={e => updateLeadField({ vertical_id: e.target.value || null })}
                style={{ fontSize: '11px', fontWeight: 500, padding: '3px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.07)', color: currentVertical ? currentVertical.color : '#4a6a9a', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', outline: 'none' }}
              >
                <option value="">Vertical</option>
                {verticals.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}

            {/* Stage badge */}
            {stageMeta && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '20px', background: stageMeta.bg, color: stageMeta.color, fontSize: '10px', fontWeight: 600, border: `1px solid ${stageMeta.color}33`, whiteSpace: 'nowrap' }}>
                ● {stageMeta.label}
              </span>
            )}

            {/* Star */}
            <button onClick={toggleStar} title={lead.starred ? 'Unfollow' : 'Follow'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: lead.starred ? '#C9A84C' : '#4a6a9a', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
            >
              {lead.starred ? '★' : '☆'}
            </button>

            {/* Quick offer jump */}
            <button onClick={() => setActiveTab('offer')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 12px', borderRadius: '6px', background: '#C9A84C', border: 'none', color: '#060e1a', fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              ✦ Offer
            </button>
          </div>

          {/* Row 2: Distress badges + quick actions */}
          <div style={{ padding: '0 20px 8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {/* Distress badges */}
            {(lead.is_pre_foreclosure || lead.is_foreclosure || lead.foreclosure_type) && (
              <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, background: 'rgba(224,123,106,0.18)', color: '#E07B6A', border: '1px solid rgba(224,123,106,0.3)' }}>
                {lead.foreclosure_type === 'P' ? 'Pre-Foreclosure' : 'Foreclosure'}
              </span>
            )}
            {lead.equity_tier && (
              <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, background: `${eClr}20`, color: eClr, border: `1px solid ${eClr}30` }}>
                {lead.equity_tier} Equity
              </span>
            )}
            {ds !== null && (
              <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, background: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)' }}>
                {ds}d filed
              </span>
            )}
            {lead.multiple_liens && (
              <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}>
                ⚠ Multiple Liens
              </span>
            )}
            {lead.imported_to_contact && (
              <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, background: 'rgba(76,175,154,0.15)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.25)' }}>
                ✓ In Pipeline
              </span>
            )}
            {currentLeadType && (
              <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, background: `${currentLeadType.color}18`, color: currentLeadType.color, border: `1px solid ${currentLeadType.color}30` }}>
                {currentLeadType.name}
              </span>
            )}

            <div style={{ flex: 1, minWidth: 8 }} />

            {/* Quick action buttons */}
            {phones.length > 0 && (
              <a href={`tel:${phones[0]}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'rgba(76,175,154,0.12)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.25)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                📞 Call
              </a>
            )}
            <button onClick={() => setActiveTab('comms')}
              style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'rgba(96,165,250,0.1)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              💬 Message
            </button>
            {!lead.imported_to_contact ? (
              <button onClick={() => setActiveTab('people')}
                style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'rgba(201,168,76,0.1)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                + Pipeline
              </button>
            ) : (
              <button onClick={() => router.push(`/contacts/${lead.imported_to_contact}`)}
                style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'rgba(76,175,154,0.1)', color: '#4CAF9A', border: '1px solid rgba(76,175,154,0.2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                View Contact →
              </button>
            )}
            <button onClick={() => setActiveTab('analyze')}
              style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ✦ AI Analysis
            </button>
            {enriching && (
              <span style={{ fontSize: '11px', color: '#4a6a9a', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, border: '1.5px solid #4a6a9a', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Enriching…
              </span>
            )}
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1a3050', background: '#0a1729', padding: '0 20px', overflowX: 'auto', flexShrink: 0 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: '10px 16px',
                fontSize: '12px',
                fontWeight: 500,
                color: activeTab === t.id ? '#C9A84C' : '#4a6a9a',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === t.id ? '2px solid #C9A84C' : '2px solid transparent',
                marginBottom: '-1px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'color .15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Body: content + persistent sidebar ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 248px', flex: 1, minHeight: 0, overflow: 'hidden' }}>

          {/* Main tab content */}
          <div style={{ overflowY: 'auto', padding: '18px 20px' }}>
            {activeTab === 'overview'   && <OverviewTab />}
            {activeTab === 'people'     && <PeopleTab />}
            {activeTab === 'contact'    && <ContactIntelligenceTab />}
            {activeTab === 'analyze'    && <AnalyzeTab />}
            {activeTab === 'offer'      && <OfferTab />}
            {activeTab === 'documents'  && <WorkspaceDocsTab />}
            {activeTab === 'comms'      && <CommunicationsTab />}
            {activeTab === 'close'      && <CloseTab />}
            {activeTab === 'listing'    && <ListingTab />}
            {activeTab === 'comps'      && <CompsTab />}
          </div>

          {/* Persistent sidebar */}
          <AcquisitionSidebar />

        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </WorkspaceContext.Provider>
  )
}
