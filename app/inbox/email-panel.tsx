'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { insertVariableAtCursor } from '@/components/VariablePicker'
import EmailPreviewModal from '@/components/EmailPreviewModal'

const VariablePicker = dynamic(() => import('@/components/VariablePicker'), { ssr: false })

// ── Types ─────────────────────────────────────────────────────────────────────

interface GmailThread {
  id: string
  snippet: string
  subject: string
  from: string
  to: string
  date: string
  unread: boolean
  messageCount: number
}

interface MessageDetail {
  id: string
  threadId: string
  from: string
  to: string
  cc: string
  subject: string
  date: string
  body: string
  attachments: { filename: string; mimeType: string; attachmentId: string }[]
  labelIds: string[]
}

interface EmailTemplate {
  id: string
  name: string
  category: string
  folder: string
  description?: string
  subject: string
  body: string
  is_builtin: boolean
  variables?: string[]
}

interface FullContact {
  id: string
  name: string
  phone: string | null
  email: string | null
  status: string | null
  category: string | null
  lead_score: string | null
  source: string | null
}

interface ContactDeal {
  id: string
  address: string
  status: string
  offer_price: number | null
  arv: number | null
}

interface AIResult {
  summary: string
  motivation: string
  motivation_reason: string
  timeline: string
  asking_price: string
  property_address: string | null
  recommended_action: string
  suggested_reply: string
}

type Folder =
  | 'INBOX' | 'SENT' | 'DRAFT' | 'ARCHIVE' | 'templates'
  | 'smart_unread' | 'smart_followup' | 'smart_contracts' | 'smart_hotleads'
  | 'smart_probate' | 'smart_preforeclosure' | 'smart_closing' | 'smart_offers'
  | 'biz_sellers' | 'biz_buyers' | 'biz_attorneys' | 'biz_title' | 'biz_lenders'
  | 'workflows' | 'scheduled'

interface OrgSuggestion {
  threadId: string
  subject: string
  from: string
  senderType: string
  category: string
  tags: string[]
  priority: string
  propertyAddress: string | null
  recommendedAction: string
  folderSuggestion: string
  approved: boolean
  skipped: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  if (!d) return ''
  const date = new Date(d)
  const now  = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  const diff = now.getTime() - date.getTime()
  if (diff < 7 * 86_400_000) return date.toLocaleDateString('en-US', { weekday: 'short' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function extractEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/)
  return m ? m[1] : raw
}

function extractName(raw: string): string {
  return raw.replace(/<[^>]+>/, '').trim().replace(/^"(.*)"$/, '$1') || raw
}

const QUICK_RESPONSES = [
  "Thank you for your email. I'll review and get back to you shortly.",
  "I'm still very interested in your property. When would be a good time to talk?",
  "Our offer is still on the table. Please let me know if you have any questions.",
  "I can close as soon as next week on your timeline. Let me know how you'd like to proceed.",
  "Could you send me a few photos of the property? That would help me finalize my offer.",
]

const CATEGORY_LABELS: Record<string, string> = {
  follow_up: 'Follow-Up',
  outreach:  'Outreach',
  contract:  'Contract',
  closing:   'Closing',
  logistics: 'Logistics',
  general:   'General',
  seller:    'Seller',
  buyer:     'Buyer',
}

const SCORE_COLORS: Record<string, string> = { Hot: '#ef4444', Warm: '#f59e0b', Cold: '#3b82f6' }

const SMART_QUERIES: Record<string, string> = {
  smart_unread:         'is:unread',
  smart_followup:       'is:starred',
  smart_contracts:      'subject:contract OR subject:"purchase agreement" OR subject:PSA',
  smart_hotleads:       'subject:interested OR subject:"want to sell" OR subject:motivated OR subject:"cash offer"',
  smart_probate:        'probate OR estate attorney',
  smart_preforeclosure: 'foreclosure OR "notice of default" OR pre-foreclosure',
  smart_closing:        'subject:closing OR "closing date" OR "clear to close"',
  smart_offers:         'subject:offer OR "as-is offer" OR "cash offer"',
}

const BIZ_CATEGORIES: Record<string, string> = {
  biz_sellers:   'Seller',
  biz_buyers:    'Buyer',
  biz_attorneys: 'Attorney',
  biz_title:     'Title Company',
  biz_lenders:   'Lender',
}

const TAG_COLORS: Record<string, string> = {
  'seller':          '#f59e0b',
  'buyer':           '#3b82f6',
  'hot-lead':        '#ef4444',
  'warm-lead':       '#f59e0b',
  'cold-lead':       '#6b7280',
  'contract':        '#10b981',
  'closing':         '#06b6d4',
  'probate':         '#8b5cf6',
  'pre-foreclosure': '#f97316',
  'attorney':        '#6b7280',
  'title':           '#64748b',
  'lender':          '#0ea5e9',
  'urgent':          '#ef4444',
  'follow-up':       '#f59e0b',
  'offer':           '#10b981',
  'docs-needed':     '#8b5cf6',
}

const PRESET_TAGS = [
  'seller', 'buyer', 'hot-lead', 'warm-lead', 'contract', 'closing',
  'probate', 'pre-foreclosure', 'attorney', 'title', 'urgent', 'follow-up', 'offer',
]

// ── Email body iframe ─────────────────────────────────────────────────────────

function EmailBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const resize = useCallback(() => {
    const f = ref.current
    if (f?.contentDocument?.body) {
      const h = f.contentDocument.body.scrollHeight
      if (h > 0) f.style.height = (h + 24) + 'px'
    }
  }, [])

  const handleLoad = useCallback(() => {
    resize()
    setTimeout(resize, 300)
    setTimeout(resize, 1000)
    setTimeout(resize, 3000)
    const f = ref.current
    if (f?.contentDocument?.body) {
      observerRef.current?.disconnect()
      const ro = new ResizeObserver(resize)
      ro.observe(f.contentDocument.body)
      observerRef.current = ro
    }
  }, [resize])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  const srcDoc = `<!DOCTYPE html><html><head><style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;margin:0;padding:16px 0}
    *{max-width:100%;box-sizing:border-box}img{max-width:100%;height:auto}
    a{color:#1a73e8}blockquote{border-left:3px solid #ddd;margin:8px 0;padding-left:12px;color:#666}
    pre{white-space:pre-wrap;background:#f5f5f5;padding:8px;border-radius:4px}
  </style></head><body>${html || '<em style="color:#999">No message body</em>'}</body></html>`

  return (
    <iframe
      ref={ref}
      srcDoc={srcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      onLoad={handleLoad}
      style={{ width: '100%', border: 'none', minHeight: 120, display: 'block', background: 'transparent' }}
      title="Email content"
    />
  )
}

// ── Tag Editor ───────────────────────────────────────────────────────────────

function TagEditor({ tags, onAdd, onRemove }: { tags: string[]; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [open, setOpen]     = useState(false)
  const [custom, setCustom] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const tagColor = (t: string) => TAG_COLORS[t] ?? '#888'

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 8, position: 'relative' }} ref={ref}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 2 }}>Tags:</span>
      {tags.map(t => (
        <span key={t} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10,
          backgroundColor: `${tagColor(t)}20`, color: tagColor(t),
          border: `1px solid ${tagColor(t)}40`,
        }}>
          {t}
          <button onClick={() => onRemove(t)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: tagColor(t), fontSize: 11, lineHeight: 1, padding: 0, opacity: 0.7 }}>
            ×
          </button>
        </span>
      ))}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setOpen(v => !v)}
          style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, border: '1px dashed var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-3)', cursor: 'pointer' }}>
          + Tag
        </button>
        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, width: 180, zIndex: 30,
            backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 8, display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {PRESET_TAGS.filter(p => !tags.includes(p)).map(p => (
                <button key={p} onClick={() => { onAdd(p); setOpen(false) }}
                  style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 8, cursor: 'pointer',
                    backgroundColor: `${TAG_COLORS[p] ?? '#888'}15`,
                    color: TAG_COLORS[p] ?? '#888',
                    border: `1px solid ${TAG_COLORS[p] ?? '#888'}30`,
                  }}>
                  {p}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input value={custom} onChange={e => setCustom(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { onAdd(custom.trim()); setCustom(''); setOpen(false) } }}
                placeholder="custom tag…"
                style={{ flex: 1, padding: '4px 6px', borderRadius: 5, fontSize: 10, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)' }}
              />
              <button onClick={() => { if (custom.trim()) { onAdd(custom.trim()); setCustom(''); setOpen(false) } }}
                style={{ padding: '4px 8px', borderRadius: 5, fontSize: 10, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Organize Panel (AI batch inbox analysis) ──────────────────────────────────

function OrganizePanel({
  suggestions,
  loading,
  onApprove,
  onApproveAll,
  onSkip,
  onClose,
}: {
  suggestions: OrgSuggestion[]
  loading: boolean
  onApprove: (threadId: string) => void
  onApproveAll: () => void
  onSkip: (threadId: string) => void
  onClose: () => void
}) {
  const priorityColor = (p: string) => p === 'high' ? '#ef4444' : p === 'low' ? '#6b7280' : '#C9A84C'
  const pending = suggestions.filter(s => !s.approved && !s.skipped)
  const done    = suggestions.filter(s => s.approved || s.skipped)

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      backgroundColor: 'var(--c-card)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-primary)' }}>AI Inbox Analysis</div>
          {!loading && <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 1 }}>{suggestions.length} emails analyzed · {pending.length} awaiting review</div>}
        </div>
        {!loading && pending.length > 0 && (
          <button onClick={onApproveAll}
            style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 7, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}>
            Approve All ({pending.length})
          </button>
        )}
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-3)', fontSize: 20, lineHeight: 1 }}>×</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--c-text-3)' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⚡</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Analyzing your inbox…</div>
            <div style={{ fontSize: 12 }}>Claude is reviewing {suggestions.length > 0 ? suggestions.length : 'your'} emails</div>
          </div>
        ) : suggestions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--c-text-3)', fontSize: 13 }}>No emails to analyze.</div>
        ) : (
          <>
            {pending.map(s => (
              <div key={s.threadId} style={{ border: '1px solid var(--c-border)', borderRadius: 10, backgroundColor: 'var(--c-card-alt)', padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                      {s.subject || '(no subject)'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{extractName(s.from) || s.from}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => onApprove(s.threadId)}
                      style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 6, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}>
                      Apply
                    </button>
                    <button onClick={() => onSkip(s.threadId)}
                      style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                      Skip
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, backgroundColor: `${priorityColor(s.priority)}18`, color: priorityColor(s.priority), fontWeight: 700 }}>
                    {s.priority.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>{s.senderType}</span>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>{s.category}</span>
                  {s.tags.map(t => (
                    <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, backgroundColor: `${TAG_COLORS[t] ?? '#888'}18`, color: TAG_COLORS[t] ?? '#888', border: `1px solid ${TAG_COLORS[t] ?? '#888'}30` }}>
                      {t}
                    </span>
                  ))}
                </div>
                {s.propertyAddress && (
                  <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 6 }}>
                    <strong style={{ color: 'var(--c-text-2)' }}>Property:</strong> {s.propertyAddress}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--c-text-2)', backgroundColor: 'var(--c-card)', borderRadius: 6, padding: '7px 9px', borderLeft: '3px solid #C9A84C' }}>
                  <strong>Action:</strong> {s.recommendedAction}
                </div>
              </div>
            ))}
            {done.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--c-text-3)', textAlign: 'center', paddingTop: 8 }}>
                {done.filter(s => s.approved).length} applied · {done.filter(s => s.skipped).length} skipped
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Action Sidebar (Action Center) ────────────────────────────────────────────

function ActionSidebar({
  senderEmail,
  senderName,
  emailSubject,
  emailBody,
  messageId,
  threadId,
  templates,
  onInsertTemplate,
  onContactMatched,
}: {
  senderEmail: string
  senderName: string
  emailSubject: string
  emailBody: string
  messageId: string
  threadId: string
  templates: EmailTemplate[]
  onInsertTemplate: (t: EmailTemplate) => void
  onContactMatched: (id: string | null) => void
}) {
  const [tab, setTab] = useState<'contact' | 'ai' | 'templates'>('contact')

  // Contact state
  const [contact, setContact]           = useState<FullContact | null>(null)
  const [contactLoading, setContactLoading] = useState(false)
  const [deals, setDeals]               = useState<ContactDeal[]>([])
  const [detectedAddresses, setDetectedAddresses] = useState<string[]>([])

  // Task creation form
  const [showTask, setShowTask]   = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDue, setTaskDue]     = useState('')
  const [taskPri, setTaskPri]     = useState('normal')
  const [savingTask, setSavingTask] = useState(false)
  const [taskDone, setTaskDone]   = useState(false)

  // CRM log
  const [crmSaving, setCrmSaving] = useState(false)
  const [crmSaved, setCrmSaved]   = useState(false)

  // AI state
  const [aiResult, setAiResult]   = useState<AIResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiErr, setAiErr]         = useState('')

  // Reset when thread changes
  useEffect(() => {
    setContact(null)
    setDeals([])
    setDetectedAddresses([])
    setShowTask(false)
    setAiResult(null)
    setAiErr('')
    setCrmSaved(false)
  }, [threadId])

  // Auto-match contact from sender email
  useEffect(() => {
    if (!senderEmail) return
    setContactLoading(true)
    fetch(`/api/contacts/search?q=${encodeURIComponent(senderEmail)}&limit=1`)
      .then(r => r.json())
      .then(d => {
        const c: FullContact | null = d.contacts?.[0] ?? null
        setContact(c)
        onContactMatched(c?.id ?? null)
        if (c?.id) {
          fetch(`/api/deals?contact_id=${c.id}&limit=5`)
            .then(r => r.json())
            .then(dd => setDeals(dd.deals ?? []))
            .catch(() => {})
        }
      })
      .catch(() => onContactMatched(null))
      .finally(() => setContactLoading(false))
  }, [senderEmail, onContactMatched])

  // Detect street addresses in email body
  useEffect(() => {
    if (!emailBody) return
    const stripped = emailBody.replace(/<[^>]*>/g, ' ').replace(/&[a-zA-Z]+;/g, ' ')
    const pat = /\b\d+\s+[A-Za-z][A-Za-z\s]{1,25}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Circle|Cir|Place|Pl|Terrace|Ter|Highway|Hwy)(?:\s*,|\b)/gi
    const found = [...new Set((stripped.match(pat) ?? []).map(s => s.replace(/,$/, '').trim()))]
    setDetectedAddresses(found.slice(0, 3))
  }, [emailBody])

  const createTask = async () => {
    if (!contact || !taskTitle.trim()) return
    setSavingTask(true)
    await fetch(`/api/contacts/${contact.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: taskTitle, due_date: taskDue || null, priority: taskPri }),
    }).catch(() => {})
    setSavingTask(false)
    setTaskTitle('')
    setTaskDue('')
    setShowTask(false)
    setTaskDone(true)
    setTimeout(() => setTaskDone(false), 3000)
  }

  const logToCRM = async () => {
    setCrmSaving(true)
    await fetch('/api/communications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:                'email',
        provider:            'gmail',
        provider_message_id: messageId,
        thread_id:           threadId,
        direction:           'inbound',
        subject:             emailSubject,
        from_email:          senderEmail,
        contact_id:          contact?.id ?? null,
        status:              'received',
      }),
    }).catch(() => {})
    setCrmSaving(false)
    setCrmSaved(true)
    setTimeout(() => setCrmSaved(false), 3000)
  }

  const analyzeEmail = async () => {
    setAnalyzing(true)
    setAiErr('')
    try {
      const res = await fetch('/api/inbox/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: emailSubject, body: emailBody, senderName, senderEmail }),
      })
      if (res.ok) {
        const data = await res.json()
        setAiResult(data)
      } else {
        setAiErr('Analysis failed — try again.')
      }
    } catch {
      setAiErr('Analysis failed — try again.')
    }
    setAnalyzing(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', borderRadius: 5, fontSize: 11,
    border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)',
    color: 'var(--c-primary)', boxSizing: 'border-box',
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: 'var(--c-text-3)',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7,
  }

  return (
    <div style={{
      width: 296, minWidth: 296, borderLeft: '1px solid var(--c-border)',
      backgroundColor: 'var(--c-card)', display: 'flex', flexDirection: 'column',
      flexShrink: 0, overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
        {(['contact', 'ai', 'templates'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '10px 0', fontSize: 11, fontWeight: tab === t ? 700 : 400,
            color: tab === t ? '#C9A84C' : 'var(--c-text-2)',
            borderBottom: tab === t ? '2px solid #C9A84C' : '2px solid transparent',
            background: 'none', border: 'none', borderTop: 'none',
            borderLeft: 'none', borderRight: 'none', cursor: 'pointer',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {t === 'contact' ? 'Contact' : t === 'ai' ? 'AI Assist' : 'Templates'}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ── Contact Tab ── */}
        {tab === 'contact' && (
          <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Contact card */}
            <div>
              <div style={sectionLabel}>Sender</div>
              {contactLoading ? (
                <p style={{ fontSize: 12, color: 'var(--c-text-3)' }}>Matching contact…</p>
              ) : contact ? (
                <div style={{ border: '1px solid var(--c-border)', borderRadius: 9, backgroundColor: 'var(--c-card-alt)', padding: '12px 13px' }}>
                  {/* Badges row */}
                  <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
                    {contact.lead_score && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                        backgroundColor: `${SCORE_COLORS[contact.lead_score] ?? '#888'}22`,
                        color: SCORE_COLORS[contact.lead_score] ?? '#888',
                      }}>
                        {contact.lead_score}
                      </span>
                    )}
                    {contact.category && (
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>
                        {contact.category}
                      </span>
                    )}
                    {contact.status && (
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>
                        {contact.status}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-primary)', marginBottom: 4 }}>{contact.name}</div>
                  {contact.phone && <div style={{ fontSize: 11, color: 'var(--c-text-2)', marginBottom: 2 }}>📞 {contact.phone}</div>}
                  {contact.source && <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Source: {contact.source}</div>}

                  {/* Quick actions */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                    {contact.phone && (
                      <a href={`tel:${contact.phone.replace(/\D/g, '')}`}
                        style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 5, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', textDecoration: 'none', cursor: 'pointer' }}>
                        📞 Call
                      </a>
                    )}
                    <a href={`/contacts/${contact.id}?tab=communications`}
                      style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 5, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', textDecoration: 'none' }}>
                      💬 SMS
                    </a>
                    <a href={`/contacts/${contact.id}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 5, backgroundColor: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', color: '#C9A84C', textDecoration: 'none' }}>
                      Open →
                    </a>
                    <button onClick={() => setShowTask(v => !v)}
                      style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 5, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                      {taskDone ? '✓ Task created' : '+ Task'}
                    </button>
                    <a href={`/deals/new?contact_id=${contact.id}`}
                      style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 5, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)', textDecoration: 'none' }}>
                      + Deal
                    </a>
                  </div>

                  {/* Inline task form */}
                  {showTask && (
                    <div style={{ marginTop: 10, padding: '10px', border: '1px solid var(--c-border)', borderRadius: 7, backgroundColor: 'var(--c-card)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input
                        value={taskTitle}
                        onChange={e => setTaskTitle(e.target.value)}
                        placeholder="Task title…"
                        style={inputStyle}
                      />
                      <div style={{ display: 'flex', gap: 5 }}>
                        <input
                          type="date"
                          value={taskDue}
                          onChange={e => setTaskDue(e.target.value)}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <select value={taskPri} onChange={e => setTaskPri(e.target.value)}
                          style={{ ...inputStyle, flex: 1 }}>
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button onClick={createTask} disabled={savingTask || !taskTitle.trim()}
                          style={{ flex: 1, padding: '6px', borderRadius: 5, fontSize: 11, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', opacity: savingTask || !taskTitle.trim() ? 0.6 : 1 }}>
                          {savingTask ? 'Saving…' : 'Save Task'}
                        </button>
                        <button onClick={() => setShowTask(false)}
                          style={{ padding: '6px 10px', borderRadius: 5, fontSize: 11, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ border: '1px solid var(--c-border)', borderRadius: 9, backgroundColor: 'var(--c-card-alt)', padding: '12px 13px' }}>
                  <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginBottom: 3 }}>No CRM contact found for</p>
                  <p style={{ fontSize: 11, color: 'var(--c-text-3)', wordBreak: 'break-all', marginBottom: 10 }}>{senderEmail}</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <a href={`/contacts/new?email=${encodeURIComponent(senderEmail)}&name=${encodeURIComponent(senderName)}`}
                      style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 5, backgroundColor: '#C9A84C', color: '#0A1F44', textDecoration: 'none' }}>
                      + Create Contact
                    </a>
                    <a href={`/leads/new?email=${encodeURIComponent(senderEmail)}&name=${encodeURIComponent(senderName)}`}
                      style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 5, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', textDecoration: 'none' }}>
                      + Create Lead
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Active deals */}
            {deals.length > 0 && (
              <div>
                <div style={sectionLabel}>Active Deals</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {deals.map(d => (
                    <a key={d.id} href={`/deals/${d.id}`}
                      style={{ display: 'block', border: '1px solid var(--c-border)', borderRadius: 8, padding: '9px 11px', textDecoration: 'none', backgroundColor: 'var(--c-card-alt)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.address}</div>
                      <div style={{ display: 'flex', gap: 6, fontSize: 10, color: 'var(--c-text-3)' }}>
                        <span style={{ color: '#C9A84C' }}>{d.status}</span>
                        {d.offer_price && <span>Offer: ${(d.offer_price / 1000).toFixed(0)}k</span>}
                        {d.arv && <span>ARV: ${(d.arv / 1000).toFixed(0)}k</span>}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Detected addresses */}
            {detectedAddresses.length > 0 && (
              <div>
                <div style={sectionLabel}>Addresses Detected in Email</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {detectedAddresses.map((addr, i) => (
                    <div key={i} style={{ border: '1px solid var(--c-border)', borderRadius: 7, padding: '8px 10px', backgroundColor: 'var(--c-card-alt)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--c-text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{addr}</span>
                      <a href={`/properties?q=${encodeURIComponent(addr)}`}
                        style={{ fontSize: 10, color: '#C9A84C', fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>
                        Search →
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Log to CRM */}
            <div>
              <div style={sectionLabel}>Log This Email</div>
              <button onClick={logToCRM} disabled={crmSaving || crmSaved}
                style={{
                  width: '100%', padding: '8px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  backgroundColor: crmSaved ? '#4ACF9A' : 'var(--c-card-alt)',
                  color: crmSaved ? '#0A1F44' : 'var(--c-text-2)',
                  border: '1px solid var(--c-border)', cursor: crmSaving || crmSaved ? 'default' : 'pointer',
                }}>
                {crmSaving ? 'Saving…' : crmSaved ? '✓ Logged to CRM' : 'Save Email to CRM'}
              </button>
            </div>
          </div>
        )}

        {/* ── AI Assist Tab ── */}
        {tab === 'ai' && (
          <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={sectionLabel}>AI Email Analysis</div>
              <p style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 10 }}>
                Claude will analyze this email and extract key details for your workflow.
              </p>
              <button onClick={analyzeEmail} disabled={analyzing}
                style={{
                  width: '100%', padding: '9px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                  backgroundColor: analyzing ? 'var(--c-hover)' : '#C9A84C',
                  color: analyzing ? 'var(--c-text-2)' : '#0A1F44',
                  border: 'none', cursor: analyzing ? 'wait' : 'pointer',
                }}>
                {analyzing ? 'Analyzing…' : '⚡ Analyze Email'}
              </button>
              {aiErr && <p style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>{aiErr}</p>}
            </div>

            {aiResult && (
              <>
                {/* Summary */}
                <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: '11px 12px', backgroundColor: 'var(--c-card-alt)' }}>
                  <div style={sectionLabel}>Summary</div>
                  <p style={{ fontSize: 12, color: 'var(--c-text-2)', lineHeight: 1.55 }}>{aiResult.summary}</p>
                </div>

                {/* Motivation + signals */}
                <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: '11px 12px', backgroundColor: 'var(--c-card-alt)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 10,
                      backgroundColor: `${SCORE_COLORS[aiResult.motivation] ?? '#888'}22`,
                      color: SCORE_COLORS[aiResult.motivation] ?? '#888',
                    }}>
                      {aiResult.motivation}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--c-text-2)', flex: 1 }}>{aiResult.motivation_reason}</span>
                  </div>
                  {aiResult.timeline !== 'Not mentioned' && (
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
                      <strong style={{ color: 'var(--c-text-2)' }}>Timeline:</strong> {aiResult.timeline}
                    </div>
                  )}
                  {aiResult.asking_price !== 'Not mentioned' && (
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
                      <strong style={{ color: 'var(--c-text-2)' }}>Asking:</strong> {aiResult.asking_price}
                    </div>
                  )}
                </div>

                {/* Recommended action */}
                <div style={{ border: '1px solid rgba(201,168,76,0.3)', borderRadius: 8, padding: '11px 12px', backgroundColor: 'rgba(201,168,76,0.06)' }}>
                  <div style={{ ...sectionLabel, color: '#C9A84C' }}>Recommended Action</div>
                  <p style={{ fontSize: 12, color: 'var(--c-primary)', fontWeight: 600 }}>{aiResult.recommended_action}</p>
                </div>

                {/* Suggested reply */}
                <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: '11px 12px', backgroundColor: 'var(--c-card-alt)' }}>
                  <div style={sectionLabel}>Suggested Reply</div>
                  <p style={{ fontSize: 12, color: 'var(--c-text-2)', lineHeight: 1.55, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{aiResult.suggested_reply}</p>
                  <button
                    onClick={() => onInsertTemplate({
                      id: '__ai__',
                      name: 'AI Reply',
                      category: 'general',
                      folder: 'General',
                      subject: `Re: ${emailSubject}`,
                      body: aiResult.suggested_reply,
                      is_builtin: false,
                    })}
                    style={{
                      width: '100%', padding: '7px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer',
                    }}>
                    Apply to Reply Composer
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Templates Tab ── */}
        {tab === 'templates' && (
          <div style={{ padding: '14px 14px' }}>
            <p style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 12 }}>
              Click a template to open it in the reply composer.
            </p>
            {Object.entries(
              templates.reduce<Record<string, EmailTemplate[]>>((acc, t) => {
                const cat = CATEGORY_LABELS[t.category] ?? t.category
                if (!acc[cat]) acc[cat] = []
                acc[cat].push(t)
                return acc
              }, {})
            ).map(([cat, list]) => (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={sectionLabel}>{cat}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {list.map(t => (
                    <button key={t.id} onClick={() => onInsertTemplate(t)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7,
                        border: '1px solid var(--c-border)', backgroundColor: 'var(--c-card-alt)',
                        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1,
                      }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-primary)' }}>{t.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--c-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Reply composer ────────────────────────────────────────────────────────────

function ReplyComposer({
  thread,
  messages,
  mode,
  templates,
  templateToApply,
  onTemplateApplied,
  contactId,
  onSent,
  onClose,
}: {
  thread: GmailThread
  messages: MessageDetail[]
  mode: 'reply' | 'replyAll' | 'forward'
  templates: EmailTemplate[]
  templateToApply: EmailTemplate | null
  onTemplateApplied: () => void
  contactId: string | null
  onSent: () => void
  onClose: () => void
}) {
  const lastMsg     = messages[messages.length - 1]
  const defaultTo   = mode === 'forward' ? '' : extractEmail(lastMsg?.from ?? thread.from)
  const defaultSubj = mode === 'forward'
    ? `Fwd: ${thread.subject}`
    : thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`

  const [to, setTo]       = useState(defaultTo)
  const [subject, setSubject] = useState(defaultSubj)
  const [body, setBody]   = useState(mode === 'forward' ? `<br><br><hr><p><strong>---------- Forwarded message ----------</strong><br>From: ${lastMsg?.from ?? ''}<br>Date: ${lastMsg?.date ?? ''}<br>Subject: ${thread.subject}</p>${lastMsg?.body ?? ''}` : '')
  const [sending, setSending] = useState(false)
  const [err, setErr]     = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [showQuick, setShowQuick]         = useState(false)
  const [showVarPicker, setShowVarPicker] = useState(false)
  const [varPickerSearch, setVarPickerSearch] = useState('')
  const [showPreview, setShowPreview]     = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const varBtnRef = useRef<HTMLDivElement>(null)

  const handleBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const ta = e.currentTarget
      const before = ta.value.slice(0, ta.selectionStart)
      if (before === '' || before.endsWith(' ') || before.endsWith('\n')) {
        e.preventDefault()
        setVarPickerSearch('')
        setShowVarPicker(true)
      }
    }
  }

  const handleVarInsert = (key: string) => {
    if (bodyRef.current) {
      insertVariableAtCursor(bodyRef.current, key, setBody)
    } else {
      setBody(prev => prev + `{{${key}}}`)
    }
  }

  // Apply template injected from ActionSidebar
  useEffect(() => {
    if (!templateToApply) return
    setSubject(templateToApply.subject)
    setBody(templateToApply.body)
    setShowTemplates(false)
    onTemplateApplied()
  }, [templateToApply, onTemplateApplied])

  const send = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) { setErr('To, Subject and Body are required'); return }
    setSending(true); setErr('')
    const isReply = mode !== 'forward'
    const endpoint = isReply ? '/api/gmail/reply' : '/api/gmail/send'
    const payload  = isReply
      ? { threadId: thread.id, lastMessageId: lastMsg?.id, to, subject, html_body: body }
      : { to, subject, html_body: body }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSending(false)
    if (res.ok) {
      // Log to CRM if a contact is linked
      if (contactId) {
        fetch('/api/communications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'email', provider: 'gmail', direction: 'outbound',
            subject, contact_id: contactId, status: 'sent',
            thread_id: thread.id,
          }),
        }).catch(() => {})
      }
      onSent()
    } else {
      const d = await res.json()
      setErr(d.error ?? 'Failed to send')
    }
  }

  const applyTemplate = (t: EmailTemplate) => {
    setSubject(t.subject)
    setBody(t.body)
    setShowTemplates(false)
  }

  return (
    <div style={{ borderTop: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)', padding: '12px 16px', flexShrink: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-primary)' }}>
          {mode === 'reply' ? 'Reply' : mode === 'replyAll' ? 'Reply All' : 'Forward'}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => setShowQuick(v => !v)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}>
            Quick
          </button>
          <button onClick={() => setShowTemplates(v => !v)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}>
            Templates
          </button>
          <div ref={varBtnRef} style={{ position: 'relative' }}>
            <button onClick={() => { setVarPickerSearch(''); setShowVarPicker(v => !v) }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: showVarPicker ? '#C9A84C20' : 'var(--c-hover)', color: showVarPicker ? '#C9A84C' : 'var(--c-text-2)', cursor: 'pointer', fontWeight: showVarPicker ? 600 : 400 }}>
              {'{{'} Var
            </button>
            {showVarPicker && (
              <VariablePicker
                initialSearch={varPickerSearch}
                onInsert={handleVarInsert}
                onClose={() => setShowVarPicker(false)}
                style={{ bottom: '100%', right: 0, marginBottom: 6 }}
              />
            )}
          </div>
          <button onClick={() => setShowPreview(true)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}>
            Preview
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-3)', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      </div>

      {/* Quick replies */}
      {showQuick && (
        <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {QUICK_RESPONSES.map((q, i) => (
            <button key={i} onClick={() => { setBody(q); setShowQuick(false) }}
              style={{ fontSize: 11, padding: '5px 10px', borderRadius: 16, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer', maxWidth: 260, textAlign: 'left' }}>
              {q.slice(0, 60)}…
            </button>
          ))}
        </div>
      )}

      {/* Templates picker */}
      {showTemplates && (
        <div style={{ marginBottom: 10, border: '1px solid var(--c-border)', borderRadius: 8, maxHeight: 180, overflowY: 'auto', backgroundColor: 'var(--c-card-alt)' }}>
          {templates.map(t => (
            <button key={t.id} onClick={() => applyTemplate(t)}
              style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12, background: 'none', border: 'none', borderBottom: '1px solid var(--c-border)', cursor: 'pointer', color: 'var(--c-primary)' }}>
              <span style={{ fontWeight: 600 }}>{t.name}</span>
              <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--c-text-3)', backgroundColor: 'var(--c-hover)', padding: '2px 6px', borderRadius: 4 }}>
                {CATEGORY_LABELS[t.category] ?? t.category}
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        <input value={to} onChange={e => setTo(e.target.value)} placeholder="To"
          style={{ width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const }} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject"
          style={{ width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const }} />
      </div>
      <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} onKeyDown={handleBodyKeyDown} placeholder="Write your message… (type / to insert a variable)" rows={5}
        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', resize: 'vertical', boxSizing: 'border-box' as const, marginBottom: 8 }} />

      {err && <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 6 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={send} disabled={sending}
          style={{ padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.7 : 1 }}>
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button onClick={() => setShowPreview(true)}
          style={{ padding: '9px 16px', borderRadius: 8, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
          Preview
        </button>
      </div>

      {showPreview && (
        <EmailPreviewModal
          subject={subject}
          body={body}
          onClose={() => setShowPreview(false)}
          onSend={() => { setShowPreview(false); send() }}
          sending={sending}
        />
      )}
    </div>
  )
}

// ── Templates view (left-nav panel) — full manager ───────────────────────────

type EditingTemplate = { id: string; name: string; subject: string; body: string; category: string; folder: string; description: string } | null

function TemplatesView({ templates, onCompose, onRefresh }: {
  templates: EmailTemplate[]
  onCompose: (t: EmailTemplate) => void
  onRefresh: () => void
}) {
  const [search,    setSearch]   = useState('')
  const [creating,  setCreating] = useState(false)
  const [editing,   setEditing]  = useState<EditingTemplate>(null)
  const [saving,    setSaving]   = useState(false)
  const [deleting,  setDeleting] = useState<string | null>(null)
  const [showVarPicker, setShowVarPicker] = useState(false)
  const bodyRef    = useRef<HTMLTextAreaElement>(null)
  const varBtnRef  = useRef<HTMLDivElement>(null)

  // New template form state
  const [form, setForm] = useState({ name: '', subject: '', body: '', category: 'general', folder: 'General', description: '' })

  const inp = (field: string) => ({
    style: { width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 12, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const, marginBottom: 6 } as React.CSSProperties,
  })

  const handleCreate = async () => {
    if (!form.name || !form.subject || !form.body) return
    setSaving(true)
    await fetch('/api/email-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false); setCreating(false)
    setForm({ name: '', subject: '', body: '', category: 'general', folder: 'General', description: '' })
    onRefresh()
  }

  const handleUpdate = async () => {
    if (!editing) return
    setSaving(true)
    await fetch(`/api/email-templates/${editing.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    })
    setSaving(false); setEditing(null)
    onRefresh()
  }

  const handleDuplicate = async (t: EmailTemplate) => {
    await fetch('/api/email-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${t.name} (copy)`, subject: t.subject, body: t.body, category: t.category, folder: t.folder ?? 'General', description: t.description ?? '' }),
    })
    onRefresh()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return
    setDeleting(id)
    await fetch(`/api/email-templates/${id}`, { method: 'DELETE' })
    setDeleting(null)
    onRefresh()
  }

  const handleVarInsertToForm = (key: string) => {
    if (bodyRef.current) {
      const ta = bodyRef.current
      const start = ta.selectionStart
      const end   = ta.selectionEnd
      const token = `{{${key}}}`
      if (editing) {
        const next = editing.body.slice(0, start) + token + editing.body.slice(end)
        setEditing({ ...editing, body: next })
      } else {
        const next = form.body.slice(0, start) + token + form.body.slice(end)
        setForm({ ...form, body: next })
      }
      requestAnimationFrame(() => { ta.focus(); const pos = start + token.length; ta.setSelectionRange(pos, pos) })
    } else {
      if (editing) setEditing({ ...editing, body: editing.body + `{{${key}}}` })
      else setForm({ ...form, body: form.body + `{{${key}}}` })
    }
  }

  const filtered = templates.filter(t => {
    if (!search) return true
    const q = search.toLowerCase()
    return t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || (t.body ?? '').toLowerCase().includes(q)
  })

  const grouped = filtered.reduce<Record<string, EmailTemplate[]>>((acc, t) => {
    const cat = CATEGORY_LABELS[t.category] ?? t.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(t)
    return acc
  }, {})

  const formCard = (isEdit: boolean) => {
    const f    = isEdit && editing ? editing : form
    const setF = isEdit && editing
      ? (patch: Partial<typeof form>) => setEditing({ ...editing!, ...patch })
      : (patch: Partial<typeof form>) => setForm({ ...form, ...patch })
    return (
      <div style={{ border: '1px solid var(--c-border)', borderRadius: 10, padding: 14, marginBottom: 14, backgroundColor: 'var(--c-card-alt)' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input value={f.name} onChange={e => setF({ name: e.target.value })} placeholder="Template name" {...inp('name')} style={{ ...inp('name').style, flex: 1, marginBottom: 0 }} />
          <select value={f.category} onChange={e => setF({ category: e.target.value })}
            style={{ padding: '7px 8px', borderRadius: 6, fontSize: 12, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', flex: '0 0 110px' }}>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <input value={f.subject} onChange={e => setF({ subject: e.target.value })} placeholder="Email subject" {...inp('subject')} />
        <input value={f.folder ?? 'General'} onChange={e => setF({ folder: e.target.value })} placeholder="Folder (e.g. Sellers, Buyers)" {...inp('folder')} />
        <input value={f.description ?? ''} onChange={e => setF({ description: e.target.value })} placeholder="Short description (optional)" {...inp('description')} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--c-text-2)' }}>Body (HTML or plain text)</span>
            <div ref={varBtnRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowVarPicker(v => !v)}
                style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                {'{{'} Insert Variable
              </button>
              {showVarPicker && (
                <VariablePicker
                  onInsert={(key) => { handleVarInsertToForm(key); setShowVarPicker(false) }}
                  onClose={() => setShowVarPicker(false)}
                  style={{ bottom: '100%', right: 0, marginBottom: 6 }}
                />
              )}
            </div>
          </div>
          <textarea
            ref={bodyRef}
            value={f.body}
            onChange={e => setF({ body: e.target.value })}
            placeholder="Email body… type {{variable}} or use Insert Variable button"
            rows={7}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 12, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={isEdit ? handleUpdate : handleCreate} disabled={saving}
            style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </button>
          <button onClick={() => isEdit ? setEditing(null) : setCreating(false)}
            style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Email Templates</h2>
        <button onClick={() => { setCreating(v => !v); setEditing(null) }}
          style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          + New
        </button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…"
        style={{ width: '100%', padding: '7px 10px', borderRadius: 7, fontSize: 12, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box', marginBottom: 12 }} />

      {creating && formCard(false)}

      {Object.entries(grouped).map(([cat, list]) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{cat}</div>
          {list.map(t => (
            <div key={t.id}>
              {editing?.id === t.id ? (
                formCard(true)
              ) : (
                <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: '10px 12px', marginBottom: 6, backgroundColor: 'var(--c-card)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                      {t.folder && t.folder !== 'General' && (
                        <div style={{ fontSize: 10, color: 'var(--c-text-3)', marginTop: 1 }}>📁 {t.folder}</div>
                      )}
                    </div>
                    {t.is_builtin && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', backgroundColor: 'var(--c-hover)', padding: '2px 6px', borderRadius: 6, whiteSpace: 'nowrap' }}>BUILT-IN</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-text-2)', marginBottom: 8, fontStyle: 'italic' }}>{t.subject}</div>
                  {t.description && (
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 8 }}>{t.description}</div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => onCompose(t)}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                      Compose →
                    </button>
                    <button onClick={() => { setEditing({ id: t.id, name: t.name, subject: t.subject, body: t.body, category: t.category, folder: t.folder ?? 'General', description: t.description ?? '' }); setCreating(false) }}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button onClick={() => handleDuplicate(t)}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
                      Duplicate
                    </button>
                    {!t.is_builtin && (
                      <button onClick={() => handleDelete(t.id)} disabled={deleting === t.id}
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer' }}>
                        {deleting === t.id ? '…' : 'Delete'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--c-text-3)', fontSize: 13, padding: '32px 0' }}>No templates found</div>
      )}
    </div>
  )
}

// ── Main EmailPanel ───────────────────────────────────────────────────────────

export default function EmailPanel() {
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null)
  const [folder, setFolder]         = useState<Folder>('INBOX')
  const [threads, setThreads]       = useState<GmailThread[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [selected, setSelected]     = useState<GmailThread | null>(null)
  const [messages, setMessages]     = useState<MessageDetail[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [replyMode, setReplyMode]   = useState<'reply' | 'replyAll' | 'forward' | null>(null)
  const [templates, setTemplates]   = useState<EmailTemplate[]>([])
  const [composeTemplate, setComposeTemplate] = useState<EmailTemplate | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')
  const [archiving, setArchiving]   = useState(false)
  const [justArchived, setJustArchived] = useState<string | null>(null)
  // Action sidebar
  const [linkedContactId, setLinkedContactId] = useState<string | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<EmailTemplate | null>(null)
  // Phase 1: tags, organize, nav sections
  const [threadTags, setThreadTags] = useState<Record<string, string[]>>({})
  const [commIds, setCommIds]       = useState<Record<string, string>>({})
  const [orgMode, setOrgMode]       = useState(false)
  const [orgLoading, setOrgLoading] = useState(false)
  const [orgSuggestions, setOrgSuggestions] = useState<OrgSuggestion[]>([])
  const [smartOpen, setSmartOpen]   = useState(true)
  const [bizOpen, setBizOpen]       = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [hoveredId, setHoveredId]   = useState<string | null>(null)
  const [bulkArchiving, setBulkArchiving] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadTemplates = useCallback(() => {
    fetch('/api/email-templates')
      .then(r => r.json())
      .then(d => setTemplates(d.templates ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/auth/gmail/status')
      .then(r => r.json())
      .then(d => setGmailConnected(d.connected))
      .catch(() => setGmailConnected(false))
    loadTemplates()
  }, [loadTemplates])

  // Thread loading — handles standard, smart, and business folders
  useEffect(() => {
    if (!gmailConnected || folder === 'templates' || folder === 'workflows' || folder === 'scheduled') return
    setLoading(true)
    setThreads([])

    // Smart folders — Gmail query
    if (folder.startsWith('smart_')) {
      const q = SMART_QUERIES[folder] ?? ''
      const qs = search ? `?q=${encodeURIComponent(q + ' ' + search)}&maxResults=30` : `?q=${encodeURIComponent(q)}&maxResults=30`
      fetch(`/api/gmail/threads${qs}`)
        .then(r => r.json())
        .then(d => setThreads(d.threads ?? []))
        .catch(() => {})
        .finally(() => setLoading(false))
      return
    }

    // Business folders — fetch contacts by category, then build from: query
    if (folder.startsWith('biz_')) {
      const category = BIZ_CATEGORIES[folder] ?? ''
      fetch(`/api/contacts/search?category=${encodeURIComponent(category)}&limit=50`)
        .then(r => r.json())
        .then(d => {
          const emails: string[] = (d.contacts ?? []).map((c: { email: string }) => c.email).filter(Boolean)
          if (emails.length === 0) { setLoading(false); return }
          const fromQuery = 'from:(' + emails.slice(0, 15).join(' OR ') + ')'
          const qs = `?q=${encodeURIComponent(fromQuery)}&maxResults=30`
          return fetch(`/api/gmail/threads${qs}`).then(r => r.json()).then(d2 => setThreads(d2.threads ?? []))
        })
        .catch(() => {})
        .finally(() => setLoading(false))
      return
    }

    // Standard folders
    const labelMap: Record<string, string> = { INBOX: 'INBOX', SENT: 'SENT', DRAFT: 'DRAFT', ARCHIVE: 'ARCHIVE' }
    const label = labelMap[folder] ?? 'INBOX'
    const qs = search ? `?label=${label}&q=${encodeURIComponent(search)}&maxResults=30` : `?label=${label}&maxResults=30`
    fetch(`/api/gmail/threads${qs}`)
      .then(r => r.json())
      .then(d => setThreads(d.threads ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [gmailConnected, folder, search])

  const openThread = async (t: GmailThread) => {
    setSelected(t)
    setReplyMode(null)
    setPendingTemplate(null)
    setLinkedContactId(null)
    setMobileView('detail')
    setLoadingMsgs(true)
    fetch(`/api/gmail/threads/${t.id}`)
      .then(r => r.json())
      .then(d => setMessages(d.messages ?? []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false))
    // Load any saved tags for this thread
    if (!threadTags[t.id]) {
      fetch(`/api/communications?thread_id=${encodeURIComponent(t.id)}&limit=1`)
        .then(r => r.json())
        .then(d => {
          const comm = d.communications?.[0]
          if (comm) {
            setCommIds(prev => ({ ...prev, [t.id]: comm.id }))
            if (comm.tags?.length) setThreadTags(prev => ({ ...prev, [t.id]: comm.tags }))
          }
        })
        .catch(() => {})
    }
  }

  const saveTagsToDb = useCallback(async (threadId: string, tags: string[]) => {
    const existingId = commIds[threadId]
    if (existingId) {
      await fetch(`/api/communications/${existingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      }).catch(() => {})
      return
    }
    const res = await fetch('/api/communications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', provider: 'gmail', thread_id: threadId, tags, status: 'received' }),
    }).catch(() => null)
    if (res?.ok) {
      const d = await res.json().catch(() => null)
      if (d?.id) setCommIds(prev => ({ ...prev, [threadId]: d.id }))
    }
  }, [commIds])

  const addTag = useCallback((threadId: string, tag: string) => {
    setThreadTags(prev => {
      const current = prev[threadId] ?? []
      if (current.includes(tag)) return prev
      const updated = [...current, tag]
      saveTagsToDb(threadId, updated)
      return { ...prev, [threadId]: updated }
    })
  }, [saveTagsToDb])

  const removeTag = useCallback((threadId: string, tag: string) => {
    setThreadTags(prev => {
      const updated = (prev[threadId] ?? []).filter(t => t !== tag)
      saveTagsToDb(threadId, updated)
      return { ...prev, [threadId]: updated }
    })
  }, [saveTagsToDb])

  const approveOrgSuggestion = useCallback((threadId: string) => {
    setOrgSuggestions(prev => prev.map(s => s.threadId === threadId ? { ...s, approved: true } : s))
    const suggestion = orgSuggestions.find(s => s.threadId === threadId)
    if (suggestion?.tags?.length) {
      suggestion.tags.forEach(tag => addTag(threadId, tag))
    }
  }, [orgSuggestions, addTag])

  const approveAllSuggestions = useCallback(() => {
    setOrgSuggestions(prev => prev.map(s => s.skipped ? s : { ...s, approved: true }))
    orgSuggestions.filter(s => !s.skipped && !s.approved).forEach(s => {
      s.tags.forEach(tag => addTag(s.threadId, tag))
    })
  }, [orgSuggestions, addTag])

  const skipOrgSuggestion = useCallback((threadId: string) => {
    setOrgSuggestions(prev => prev.map(s => s.threadId === threadId ? { ...s, skipped: true } : s))
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const bulkArchive = async () => {
    if (!selectedIds.size) return
    setBulkArchiving(true)
    await Promise.all([...selectedIds].map(id =>
      fetch('/api/gmail/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: id }),
      }).catch(() => {})
    ))
    setThreads(prev => prev.filter(t => !selectedIds.has(t.id)))
    if (selected && selectedIds.has(selected.id)) setSelected(null)
    setSelectedIds(new Set())
    setBulkArchiving(false)
  }

  const bulkDelete = async () => {
    if (!selectedIds.size) return
    setBulkDeleting(true)
    await Promise.all([...selectedIds].map(id =>
      fetch('/api/gmail/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: id }),
      }).catch(() => {})
    ))
    setThreads(prev => prev.filter(t => !selectedIds.has(t.id)))
    if (selected && selectedIds.has(selected.id)) setSelected(null)
    setSelectedIds(new Set())
    setBulkDeleting(false)
  }

  const deleteThread = async () => {
    if (!selected) return
    setDeleting(true)
    await fetch('/api/gmail/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: selected.id }),
    })
    setThreads(prev => prev.filter(t => t.id !== selected.id))
    setSelected(null)
    setDeleting(false)
  }

  const openOrganize = async (idsToAnalyze?: Set<string>) => {
    setOrgMode(true)
    setOrgLoading(true)
    setOrgSuggestions([])
    const source = idsToAnalyze
      ? threads.filter(t => idsToAnalyze.has(t.id))
      : threads.slice(0, 25)
    const payload = source.map(t => ({
      threadId: t.id, subject: t.subject, from: t.from, snippet: t.snippet, date: t.date,
    }))
    try {
      const res = await fetch('/api/inbox/ai-organize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threads: payload }),
      })
      if (res.ok) {
        const d = await res.json()
        setOrgSuggestions((d.suggestions ?? []).map((s: OrgSuggestion) => ({ ...s, approved: false, skipped: false })))
      }
    } catch {}
    setOrgLoading(false)
    if (idsToAnalyze) clearSelection()
  }

  const archive = async () => {
    if (!selected) return
    setArchiving(true)
    await fetch('/api/gmail/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: selected.id }),
    })
    setJustArchived(selected.id)
    setThreads(prev => prev.filter(t => t.id !== selected.id))
    setSelected(null)
    setArchiving(false)
    setTimeout(() => setJustArchived(null), 2000)
  }

  const handleTemplateCompose = (t: EmailTemplate) => {
    setComposeTemplate(t)
    setFolder('INBOX')
    setSelected(null)
  }

  // Called by ActionSidebar when user clicks a template — open composer + inject
  const applyTemplateInComposer = useCallback((t: EmailTemplate) => {
    setPendingTemplate(t)
    setReplyMode(prev => prev ?? 'reply')
  }, [])

  const handleContactMatched = useCallback((id: string | null) => {
    setLinkedContactId(id)
  }, [])

  const lastMsg    = messages[messages.length - 1]
  const senderRaw  = selected ? (messages.find(m => m.from && !m.from.includes(lastMsg?.to ?? ''))?.from ?? selected.from) : ''
  const senderEmail = extractEmail(senderRaw)
  const senderName  = extractName(senderRaw)

  if (gmailConnected === false) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 32 }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: 'var(--c-card-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text-2)' }}>Gmail not connected</p>
        <a href="/settings" style={{ fontSize: 13, color: '#C9A84C', fontWeight: 600 }}>Connect Gmail in Settings →</a>
      </div>
    )
  }

  const navBtn = (id: string, label: string, icon: string, disabled = false) => (
    <button key={id}
      onClick={() => { if (disabled) return; setFolder(id as Folder); setSelected(null); setReplyMode(null); setOrgMode(false); clearSelection() }}
      style={{
        width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12,
        display: 'flex', alignItems: 'center', gap: 7,
        backgroundColor: folder === id ? 'rgba(201,168,76,0.12)' : 'transparent',
        color: disabled ? 'var(--c-text-3)' : folder === id ? '#C9A84C' : 'var(--c-text-2)',
        fontWeight: folder === id ? 600 : 400,
        border: 'none', cursor: disabled ? 'default' : 'pointer', borderRadius: 5,
      }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {disabled && <span style={{ fontSize: 9, backgroundColor: 'var(--c-hover)', padding: '1px 4px', borderRadius: 3, color: 'var(--c-text-3)' }}>Soon</span>}
    </button>
  )

  const sectionHeader = (label: string, open: boolean, toggle: () => void) => (
    <button onClick={toggle} style={{
      width: '100%', display: 'flex', alignItems: 'center', padding: '6px 12px 4px',
      background: 'none', border: 'none', cursor: 'pointer', gap: 5,
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', flex: 1, textAlign: 'left' }}>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{open ? '▾' : '▸'}</span>
    </button>
  )

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, color: 'var(--c-primary)' }}>

      {/* ── Left nav ── */}
      <div
        className={`${mobileView === 'list' ? 'flex' : 'hidden'} md:flex flex-col`}
        style={{ width: 210, minWidth: 210, borderRight: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)', flexShrink: 0, padding: '10px 0', overflowY: 'auto' }}
      >
        {/* Compose */}
        <div style={{ padding: '0 10px 8px' }}>
          <button onClick={() => { setSelected(null); setComposeTemplate(null); setFolder('INBOX'); setOrgMode(false); clearSelection() }}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: 'pointer' }}>
            + Compose
          </button>
        </div>

        {/* AI Organize button */}
        {gmailConnected && (
          <div style={{ padding: '0 10px 8px' }}>
            <button onClick={() => openOrganize(selectedIds.size > 0 ? selectedIds : undefined)}
              style={{ width: '100%', padding: '7px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600, backgroundColor: 'rgba(201,168,76,0.1)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.25)', cursor: 'pointer' }}>
              {selectedIds.size > 0 ? `⚡ Organize (${selectedIds.size})` : '⚡ Organize Inbox'}
            </button>
          </div>
        )}

        {/* MAIL section */}
        <div style={{ height: 1, backgroundColor: 'var(--c-border)', margin: '4px 10px 6px' }} />
        <div style={{ padding: '0 4px' }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 8px', marginBottom: 2 }}>Mail</p>
          {navBtn('INBOX',    'Inbox',    '📥')}
          {navBtn('SENT',     'Sent',     '📤')}
          {navBtn('DRAFT',    'Drafts',   '📝')}
          {navBtn('ARCHIVE',  'Archive',  '🗄️')}
        </div>

        {/* SMART FOLDERS section */}
        <div style={{ height: 1, backgroundColor: 'var(--c-border)', margin: '6px 10px' }} />
        <div style={{ padding: '0 4px' }}>
          {sectionHeader('Smart Folders', smartOpen, () => setSmartOpen(v => !v))}
          {smartOpen && (
            <>
              {navBtn('smart_unread',         'Unread',          '🔵')}
              {navBtn('smart_followup',        'Follow Up',       '⭐')}
              {navBtn('smart_contracts',       'Contracts',       '📄')}
              {navBtn('smart_hotleads',        'Hot Leads',       '🔥')}
              {navBtn('smart_probate',         'Probate',         '⚖️')}
              {navBtn('smart_preforeclosure',  'Pre-Foreclosure', '🏚️')}
              {navBtn('smart_closing',         'Closing',         '🏁')}
              {navBtn('smart_offers',          'Offers',          '💰')}
            </>
          )}
        </div>

        {/* BY CONTACT section */}
        <div style={{ height: 1, backgroundColor: 'var(--c-border)', margin: '6px 10px' }} />
        <div style={{ padding: '0 4px' }}>
          {sectionHeader('By Contact', bizOpen, () => setBizOpen(v => !v))}
          {bizOpen && (
            <>
              {navBtn('biz_sellers',   'Sellers',        '🏠')}
              {navBtn('biz_buyers',    'Buyers',         '👤')}
              {navBtn('biz_attorneys', 'Attorneys',      '⚖️')}
              {navBtn('biz_title',     'Title Co',       '📋')}
              {navBtn('biz_lenders',   'Lenders',        '🏦')}
            </>
          )}
        </div>

        {/* OTHER section */}
        <div style={{ height: 1, backgroundColor: 'var(--c-border)', margin: '6px 10px' }} />
        <div style={{ padding: '0 4px' }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 8px', marginBottom: 2 }}>Other</p>
          {navBtn('templates',  'Templates',  '📋')}
          {navBtn('workflows',  'Workflows',  '⚡', true)}
          {navBtn('scheduled',  'Scheduled',  '🕒', true)}
        </div>
      </div>

      {/* ── Templates full-width view ── */}
      {folder === 'templates' && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--c-card-alt)' }}>
          <TemplatesView templates={templates} onCompose={handleTemplateCompose} onRefresh={loadTemplates} />
        </div>
      )}

      {/* ── Email area (thread list + viewer + sidebar) ── */}
      {folder !== 'templates' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, position: 'relative' }}>
          {orgMode && (
            <OrganizePanel
              suggestions={orgSuggestions}
              loading={orgLoading}
              onApprove={approveOrgSuggestion}
              onApproveAll={approveAllSuggestions}
              onSkip={skipOrgSuggestion}
              onClose={() => setOrgMode(false)}
            />
          )}
        <>
          {/* Center thread list */}
          <div
            className={`${mobileView === 'list' ? 'flex' : 'hidden'} md:flex flex-col`}
            style={{ width: 280, minWidth: 280, maxWidth: 280, borderRight: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)', flexShrink: 0 }}
          >
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--c-border)' }}>
              {selectedIds.size > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--c-text-2)', fontWeight: 600, flex: 1 }}>{selectedIds.size} selected</span>
                  <button
                    onClick={() => bulkArchive()}
                    disabled={bulkArchiving || bulkDeleting}
                    style={{ fontSize: 11, padding: '4px 9px', borderRadius: 5, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer', fontWeight: 500 }}
                  >
                    {bulkArchiving ? '…' : 'Archive'}
                  </button>
                  <button
                    onClick={() => bulkDelete()}
                    disabled={bulkArchiving || bulkDeleting}
                    style={{ fontSize: 11, padding: '4px 9px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.06)', color: '#ef4444', cursor: 'pointer', fontWeight: 500 }}
                  >
                    {bulkDeleting ? '…' : 'Delete'}
                  </button>
                  <button
                    onClick={() => openOrganize(selectedIds)}
                    disabled={bulkArchiving || bulkDeleting}
                    style={{ fontSize: 11, padding: '4px 9px', borderRadius: 5, border: '1px solid rgba(201,168,76,0.4)', backgroundColor: 'rgba(201,168,76,0.08)', color: '#C9A84C', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Organize
                  </button>
                  <button
                    onClick={clearSelection}
                    style={{ fontSize: 14, lineHeight: 1, padding: '2px 5px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--c-text-3)' }}
                    title="Clear selection"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text-3)' }} width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
                  </svg>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search…"
                    style={{ width: '100%', paddingLeft: 28, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 6, fontSize: 12, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const }}
                  />
                </div>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {loading ? (
                <p style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--c-text-3)' }}>Loading…</p>
              ) : threads.length === 0 ? (
                <p style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--c-text-3)' }}>
                  {search ? 'No results' : 'No emails'}
                </p>
              ) : (
                threads.filter(t => t.id !== justArchived).map(t => {
                  const isSelected = selectedIds.has(t.id)
                  const showCheck = isSelected || hoveredId === t.id || selectedIds.size > 0
                  return (
                    <div key={t.id} style={{ position: 'relative' }}
                      onMouseEnter={() => setHoveredId(t.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      {/* Checkbox */}
                      {showCheck && (
                        <button
                          onClick={e => { e.stopPropagation(); toggleSelect(t.id) }}
                          style={{
                            position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
                            zIndex: 2, width: 18, height: 18, borderRadius: 4, border: `2px solid ${isSelected ? '#C9A84C' : 'var(--c-border)'}`,
                            backgroundColor: isSelected ? '#C9A84C' : 'var(--c-card)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0,
                          }}
                        >
                          {isSelected && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </button>
                      )}
                      <button onClick={() => openThread(t)} style={{
                        width: '100%', textAlign: 'left',
                        paddingTop: 11, paddingBottom: 11,
                        paddingLeft: showCheck ? 32 : 14, paddingRight: 14,
                        backgroundColor: isSelected ? 'rgba(201,168,76,0.07)' : selected?.id === t.id ? 'rgba(201,168,76,0.1)' : 'transparent',
                        borderLeft: selected?.id === t.id ? '3px solid #C9A84C' : '3px solid transparent',
                        border: 'none', borderBottom: '1px solid var(--c-border)',
                        cursor: 'pointer', transition: 'padding-left 0.1s',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 12, fontWeight: t.unread ? 700 : 500, color: 'var(--c-primary)', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {folder === 'SENT' ? extractEmail(t.to) : extractName(t.from) || extractEmail(t.from)}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                            {t.unread && <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#C9A84C', display: 'inline-block' }} />}
                            <span style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{fmtDate(t.date)}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: t.unread ? 600 : 400, color: 'var(--c-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                          {t.subject || '(no subject)'}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--c-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.snippet}</span>
                          {t.messageCount > 1 && <span style={{ fontSize: 10, color: 'var(--c-text-3)', marginLeft: 6, flexShrink: 0 }}>{t.messageCount}</span>}
                        </div>
                        {(threadTags[t.id]?.length ?? 0) > 0 && (
                          <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                            {threadTags[t.id].slice(0, 3).map(tag => (
                              <span key={tag} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, backgroundColor: `${TAG_COLORS[tag] ?? '#888'}20`, color: TAG_COLORS[tag] ?? '#888' }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Email viewer + Action Sidebar */}
          <div
            className={`${mobileView === 'detail' ? 'flex' : 'hidden'} md:flex flex-1`}
            style={{ overflow: 'hidden', minWidth: 0, minHeight: 0 }}
          >
            {/* Email viewer */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              {/* Compose from template */}
              {composeTemplate && !selected && (
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>New Email — {composeTemplate.name}</span>
                    <button onClick={() => setComposeTemplate(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-3)', fontSize: 18 }}>×</button>
                  </div>
                  <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
                    <ComposeNew template={composeTemplate} templates={templates} onClose={() => setComposeTemplate(null)} />
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!selected && !composeTemplate && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', backgroundColor: 'var(--c-card-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p style={{ fontSize: 14, color: 'var(--c-text-2)', fontWeight: 500 }}>Select an email to read</p>
                </div>
              )}

              {/* Email thread viewer */}
              {selected && (
                <div style={{
                  flex: 1,
                  display: 'grid',
                  gridTemplateRows: replyMode && !loadingMsgs ? 'auto 1fr auto' : 'auto 1fr',
                  overflow: 'hidden',
                  minHeight: 0,
                }}>
                  {/* Thread header */}
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <button className="md:hidden" onClick={() => setMobileView('list')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-2)', paddingTop: 2, flexShrink: 0 }}>
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selected.subject || '(no subject)'}
                        </h2>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {(['reply', 'replyAll', 'forward'] as const).map(m => (
                            <button key={m} onClick={() => setReplyMode(replyMode === m ? null : m)}
                              style={{
                                fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', cursor: 'pointer',
                                backgroundColor: replyMode === m ? 'rgba(201,168,76,0.15)' : 'var(--c-hover)',
                                color: replyMode === m ? '#C9A84C' : 'var(--c-text-2)', fontWeight: 500,
                              }}>
                              {m === 'reply' ? '↩ Reply' : m === 'replyAll' ? '↩↩ Reply All' : '→ Forward'}
                            </button>
                          ))}
                          <button onClick={archive} disabled={archiving || deleting}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', cursor: 'pointer', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', opacity: (archiving || deleting) ? 0.5 : 1 }}>
                            🗄️ {archiving ? 'Archiving…' : 'Archive'}
                          </button>
                          <button onClick={deleteThread} disabled={archiving || deleting}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.35)', cursor: 'pointer', backgroundColor: 'rgba(239,68,68,0.06)', color: '#ef4444', opacity: (archiving || deleting) ? 0.5 : 1 }}>
                            🗑️ {deleting ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                        <TagEditor
                          tags={threadTags[selected.id] ?? []}
                          onAdd={tag => addTag(selected.id, tag)}
                          onRemove={tag => removeTag(selected.id, tag)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Messages scroll area */}
                  <div style={{ overflowY: 'auto' }}>
                    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {loadingMsgs ? (
                        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--c-text-3)' }}>Loading…</p>
                      ) : (
                        messages.map((msg, i) => {
                          const isLast = i === messages.length - 1
                          return (
                            <div key={msg.id} style={{ border: '1px solid var(--c-border)', borderRadius: 10, backgroundColor: 'var(--c-card)', overflow: 'hidden' }}>
                              <div style={{ padding: '10px 14px', borderBottom: isLast ? '1px solid var(--c-border)' : undefined, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ minWidth: 0 }}>
                                  <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{msg.from}</p>
                                  {msg.to && <p style={{ fontSize: 11, color: 'var(--c-text-3)' }}>To: {msg.to}</p>}
                                  {msg.cc && <p style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Cc: {msg.cc}</p>}
                                </div>
                                <p style={{ fontSize: 11, color: 'var(--c-text-3)', flexShrink: 0 }}>
                                  {msg.date ? new Date(msg.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                                </p>
                              </div>
                              {isLast || messages.length === 1 ? (
                                <div style={{ padding: '0 14px' }}>
                                  <EmailBody html={msg.body} />
                                </div>
                              ) : (
                                <CollapsedMessage msg={msg} />
                              )}
                              {msg.attachments.length > 0 && (
                                <div style={{ padding: '8px 14px', borderTop: '1px solid var(--c-border)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {msg.attachments.map((a, j) => (
                                    <span key={j} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                                      📎 {a.filename}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>

                  {/* Reply composer (row 3) */}
                  {replyMode && !loadingMsgs && (
                    <ReplyComposer
                      thread={selected}
                      messages={messages}
                      mode={replyMode}
                      templates={templates}
                      templateToApply={pendingTemplate}
                      onTemplateApplied={() => setPendingTemplate(null)}
                      contactId={linkedContactId}
                      onSent={() => setReplyMode(null)}
                      onClose={() => setReplyMode(null)}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Action Sidebar — always visible when a thread is open */}
            {selected && (
              <ActionSidebar
                senderEmail={senderEmail}
                senderName={senderName}
                emailSubject={selected.subject}
                emailBody={lastMsg?.body ?? ''}
                messageId={lastMsg?.id ?? ''}
                threadId={selected.id}
                templates={templates}
                onInsertTemplate={applyTemplateInComposer}
                onContactMatched={handleContactMatched}
              />
            )}
          </div>
        </>
        </div>
      )}
    </div>
  )
}

// ── Collapsed message (older messages in thread) ──────────────────────────────

function CollapsedMessage({ msg }: { msg: MessageDetail }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)} style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--c-text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {open ? 'Collapse' : `${msg.from.replace(/<.*>/, '').trim()} — click to expand`}
      </button>
      {open && (
        <div style={{ padding: '0 14px 8px' }}>
          <EmailBody html={msg.body} />
        </div>
      )}
    </div>
  )
}

// ── Standalone compose (from template) ───────────────────────────────────────

function ComposeNew({ template, templates, onClose }: { template: EmailTemplate; templates: EmailTemplate[]; onClose: () => void }) {
  const [to, setTo]       = useState('')
  const [subject, setSubject] = useState(template.subject)
  const [body, setBody]   = useState(template.body)
  const [sending, setSending] = useState(false)
  const [err, setErr]     = useState('')
  const [showTmpl, setShowTmpl]       = useState(false)
  const [showVarPicker, setShowVarPicker] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const send = async () => {
    if (!to.trim()) { setErr('To is required'); return }
    setSending(true); setErr('')
    const res = await fetch('/api/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html_body: body }),
    })
    setSending(false)
    if (res.ok) { onClose() }
    else { const d = await res.json(); setErr(d.error ?? 'Failed to send') }
  }

  const handleVarInsert = (key: string) => {
    if (bodyRef.current) {
      insertVariableAtCursor(bodyRef.current, key, setBody)
    } else {
      setBody(prev => prev + `{{${key}}}`)
    }
  }

  const handleBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const ta = e.currentTarget
      const before = ta.value.slice(0, ta.selectionStart)
      if (before === '' || before.endsWith(' ') || before.endsWith('\n')) {
        e.preventDefault()
        setShowVarPicker(true)
      }
    }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 4 }}>To</label>
        <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@email.com"
          style={{ width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const }} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--c-text-2)', display: 'block', marginBottom: 4 }}>Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' as const }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--c-text-2)' }}>Body</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowVarPicker(v => !v)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--c-border)', backgroundColor: showVarPicker ? '#C9A84C20' : 'var(--c-hover)', color: showVarPicker ? '#C9A84C' : 'var(--c-text-2)', cursor: 'pointer' }}>
                {'{{'} Var
              </button>
              {showVarPicker && (
                <VariablePicker
                  onInsert={(key) => { handleVarInsert(key); setShowVarPicker(false) }}
                  onClose={() => setShowVarPicker(false)}
                  style={{ bottom: '100%', right: 0, marginBottom: 6 }}
                />
              )}
            </div>
            <button onClick={() => setShowTmpl(v => !v)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', cursor: 'pointer' }}>Switch template</button>
          </div>
        </div>
        {showTmpl && (
          <div style={{ border: '1px solid var(--c-border)', borderRadius: 6, maxHeight: 150, overflowY: 'auto', marginBottom: 8, backgroundColor: 'var(--c-card-alt)' }}>
            {templates.map(t => (
              <button key={t.id} onClick={() => { setSubject(t.subject); setBody(t.body); setShowTmpl(false) }}
                style={{ width: '100%', textAlign: 'left', padding: '7px 10px', fontSize: 12, background: 'none', border: 'none', borderBottom: '1px solid var(--c-border)', cursor: 'pointer', color: 'var(--c-primary)', fontWeight: 600 }}>
                {t.name}
              </button>
            ))}
          </div>
        )}
        <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} onKeyDown={handleBodyKeyDown} rows={10}
          placeholder="Write your email… (type / to insert a variable)"
          style={{ width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', resize: 'vertical', boxSizing: 'border-box' as const, fontFamily: 'inherit' }} />
      </div>
      {err && <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={send} disabled={sending}
          style={{ padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', border: 'none', cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.7 : 1 }}>
          {sending ? 'Sending…' : 'Send Email'}
        </button>
        <button onClick={() => setShowPreview(true)}
          style={{ padding: '9px 16px', borderRadius: 8, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
          Preview
        </button>
        <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, fontSize: 13, border: '1px solid var(--c-border)', backgroundColor: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>

      {showPreview && (
        <EmailPreviewModal
          subject={subject}
          body={body}
          onClose={() => setShowPreview(false)}
          onSend={() => { setShowPreview(false); send() }}
          sending={sending}
        />
      )}
    </div>
  )
}
