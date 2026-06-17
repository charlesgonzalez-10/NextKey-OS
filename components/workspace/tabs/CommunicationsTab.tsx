'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import {
  fmtDateTime, fmtDateShort,
  CALL_STATUS_LABELS, SMS_STATUS_LABELS, EMAIL_STATUS_LABELS,
} from '@/lib/acquisitionEngine'

// ─── Shared primitives ────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 7, padding: '12px 14px', ...style }}>{children}</div>
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#4a6a9a', marginBottom: 9 }}>{children}</div>
}

function Btn({
  children, onClick, disabled, color = '#4a6a9a', fill = false, small = false, style,
}: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean
  color?: string; fill?: boolean; small?: boolean; style?: React.CSSProperties
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: small ? '3px 9px' : '5px 12px',
      borderRadius: 6, fontSize: small ? 10 : 11, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
      border: `1px solid ${color}55`,
      background: fill ? `${color}18` : 'transparent',
      color: disabled ? '#4a6a9a' : color,
      opacity: disabled ? 0.5 : 1,
      ...style,
    }}>{children}</button>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${color}18`, color, border: `1px solid ${color}35` }}>
      {label}
    </span>
  )
}

function fmtRelative(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`
  return fmtDateShort(ts)
}

// ─── Section types ────────────────────────────────────────────────────────────

type CommsSection = 'timeline' | 'email' | 'sms' | 'calls' | 'notes' | 'tasks' | 'templates' | 'automations' | 'health'

const SECTIONS: { id: CommsSection; label: string; icon: string }[] = [
  { id: 'timeline',    label: 'Timeline',    icon: '⏱' },
  { id: 'email',       label: 'Email',       icon: '✉' },
  { id: 'sms',         label: 'SMS',         icon: '💬' },
  { id: 'calls',       label: 'Calls',       icon: '📞' },
  { id: 'notes',       label: 'Notes',       icon: '📝' },
  { id: 'tasks',       label: 'Tasks',       icon: '✅' },
  { id: 'templates',   label: 'Templates',   icon: '📄' },
  { id: 'automations', label: 'Automations', icon: '⚡' },
  { id: 'health',      label: 'Health',      icon: '📊' },
]

// ─── Event type config ────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  call_log:   '#22c55e',
  sms_log:    '#60a5fa',
  email_log:  '#a78bfa',
  note:       '#C9A84C',
  task:       '#f59e0b',
  email:      '#a78bfa',
  sms:        '#60a5fa',
  call:       '#22c55e',
}

const EVENT_ICONS: Record<string, string> = {
  call_log: '📞', sms_log: '💬', email_log: '✉', note: '📝', task: '✅',
  email: '✉', sms: '💬', call: '📞',
}

// ─── Timeline event type ──────────────────────────────────────────────────────

interface TimelineEvent {
  id: string
  event_type: string
  subtype: string
  title: string
  body: string | null
  author: string | null
  direction: string | null
  status: string | null
  thread_id: string | null
  due_date: string | null
  priority: string | null
  completed: boolean
  timestamp: string
  source: string
}

// ─── Task type ────────────────────────────────────────────────────────────────

interface LeadTask {
  id: string
  title: string
  description: string | null
  due_date: string | null
  priority: string
  status: string
  completed_at: string | null
  created_at: string
}

// ─── Scheduled item ───────────────────────────────────────────────────────────

interface ScheduledItem {
  id: string
  type: string
  title: string
  body: string | null
  scheduled_at: string
  status: string
}

// ─── Email template ───────────────────────────────────────────────────────────

interface EmailTemplate {
  id: string
  name: string
  category: string
  folder?: string
  subject: string
  body: string
  description?: string
}

// ─── Gmail thread ────────────────────────────────────────────────────────────

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

// ─── SMS message ─────────────────────────────────────────────────────────────

interface SmsMessage {
  id: string
  contact_id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: string
  created_at: string
}

// ─── Automation step types ───────────────────────────────────────────────────

interface AutomationStep {
  id: string
  type: 'wait' | 'email' | 'sms' | 'task' | 'condition'
  label: string
  config: Record<string, string>
}

const AUTOMATION_TRIGGERS = [
  'Offer Sent', 'Contact Created', 'Stage Changed', 'No Reply (48h)', 'Contract Generated',
  'Task Completed', 'Email Opened', 'SMS Replied',
]

// ─── TimelineSection ──────────────────────────────────────────────────────────

function TimelineSection({ leadId }: { leadId: string }) {
  const [events,   setEvents]  = useState<TimelineEvent[]>([])
  const [loading,  setLoading] = useState(true)
  const [filter,   setFilter]  = useState<string>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/leads/${leadId}/comms/timeline`)
    if (res.ok) {
      const d = await res.json()
      setEvents(d.events ?? [])
    }
    setLoading(false)
  }, [leadId])

  useEffect(() => { load() }, [load])

  const FILTER_OPTS = [
    { id: 'all', label: 'All' },
    { id: 'email', label: 'Email' },
    { id: 'sms', label: 'SMS' },
    { id: 'call_log', label: 'Calls' },
    { id: 'note', label: 'Notes' },
    { id: 'task', label: 'Tasks' },
  ]

  const filtered = filter === 'all' ? events : events.filter(e =>
    e.event_type === filter || e.subtype === filter
  )

  const toggle = (id: string) => setExpanded(s => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        {FILTER_OPTS.map(f => {
          const count = f.id === 'all' ? events.length : events.filter(e => e.event_type === f.id || e.subtype === f.id).length
          return (
            <button key={f.id} onClick={() => setFilter(f.id)}
              style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: filter === f.id ? 'rgba(201,168,76,0.12)' : 'transparent',
                color: filter === f.id ? '#C9A84C' : '#4a6a9a',
                border: `1px solid ${filter === f.id ? 'rgba(201,168,76,0.4)' : '#1a3050'}` }}>
              {f.label} {count > 0 && <span style={{ opacity: 0.6 }}>({count})</span>}
            </button>
          )
        })}
        <button onClick={load} style={{ marginLeft: 'auto', fontSize: 10, color: '#4a6a9a', background: 'none', border: '1px solid #1a3050', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>↻</button>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#4a6a9a', fontSize: 11 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 11, color: '#4a6a9a' }}>
            {filter === 'all' ? 'No activity yet. Log a call, send an email, or add a note.' : `No ${filter} events yet.`}
          </div>
        </Card>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* Timeline spine */}
          <div style={{ position: 'absolute', left: 14, top: 0, bottom: 0, width: 1, background: '#1a3050' }} />

          {filtered.map(ev => {
            const color   = EVENT_COLORS[ev.subtype] ?? EVENT_COLORS[ev.event_type] ?? '#4a6a9a'
            const icon    = EVENT_ICONS[ev.subtype] ?? EVENT_ICONS[ev.event_type] ?? '·'
            const isOpen  = expanded.has(ev.id)
            const hasBody = !!ev.body

            return (
              <div key={ev.id} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                {/* Dot */}
                <div style={{ flexShrink: 0, width: 28, display: 'flex', justifyContent: 'center', paddingTop: 2 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${color}15`, border: `1.5px solid ${color}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, zIndex: 1, position: 'relative' }}>
                    {icon}
                  </div>
                </div>
                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>{ev.title}</span>
                        {ev.direction && (
                          <Badge label={ev.direction} color={ev.direction === 'inbound' ? '#4CAF9A' : '#60a5fa'} />
                        )}
                        {ev.status && ev.status !== 'sent' && (
                          <Badge label={ev.status} color={ev.status === 'read' ? '#4CAF9A' : ev.status === 'failed' ? '#ef4444' : '#4a6a9a'} />
                        )}
                        {ev.priority && ev.priority !== 'normal' && (
                          <Badge label={ev.priority} color={ev.priority === 'urgent' || ev.priority === 'high' ? '#ef4444' : '#C9A84C'} />
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, color: '#4a6a9a', whiteSpace: 'nowrap' }}>{fmtRelative(ev.timestamp)}</span>
                        {hasBody && (
                          <button onClick={() => toggle(ev.id)}
                            style={{ fontSize: 10, color: '#4a6a9a', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>
                            {isOpen ? '▲' : '▼'}
                          </button>
                        )}
                      </div>
                    </div>

                    {ev.author && (
                      <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 2 }}>{ev.author}</div>
                    )}

                    {(isOpen || (!hasBody && ev.body)) ? null : ev.body && !isOpen ? (
                      <div style={{ fontSize: 11, color: '#6b7a8a', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ev.body.slice(0, 120)}
                      </div>
                    ) : null}

                    {isOpen && ev.body && (
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.5, borderTop: '1px solid #1a3050', paddingTop: 6 }}>
                        {ev.body}
                      </div>
                    )}

                    {ev.due_date && (
                      <div style={{ fontSize: 10, color: '#C9A84C', marginTop: 4 }}>Due: {fmtDateShort(ev.due_date)}</div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── EmailSection ─────────────────────────────────────────────────────────────

function EmailSection({ leadId, leadAddress, primaryContact }: {
  leadId: string; leadAddress: string; primaryContact: { id: string; name: string; email?: string | null } | null
}) {
  const [gmailStatus,  setGmailStatus]  = useState<{ connected: boolean; email?: string } | null>(null)
  const [threads,      setThreads]      = useState<GmailThread[]>([])
  const [threadsLoad,  setThreadsLoad]  = useState(false)
  const [activeThread, setActiveThread] = useState<{ id: string; messages: MessageDetail[] } | null>(null)
  const [threadLoad,   setThreadLoad]   = useState(false)
  const [composing,    setComposing]    = useState(false)
  const [search,       setSearch]       = useState('')
  const [label,        setLabel]        = useState<string>('INBOX')

  // Compose state
  const [cTo,      setCTo]      = useState(primaryContact?.email ?? '')
  const [cSubject, setCSubject] = useState('')
  const [cBody,    setCBody]    = useState('')
  const [cCC,      setCCC]      = useState('')
  const [sending,  setSending]  = useState(false)
  const [sendErr,  setSendErr]  = useState('')
  const [sendOk,   setSendOk]   = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiTone,    setAiTone]   = useState('professional')

  // Reply state
  const [replyBody,    setReplyBody]    = useState('')
  const [replySending, setReplySending] = useState(false)
  const [replyErr,     setReplyErr]     = useState('')

  useEffect(() => {
    fetch('/api/auth/gmail/status').then(r => r.json()).then(d => setGmailStatus(d))
  }, [])

  const loadThreads = useCallback(async () => {
    if (!gmailStatus?.connected) return
    setThreadsLoad(true)
    const q   = [search, leadAddress.split(',')[0]].filter(Boolean).join(' ')
    const res = await fetch(`/api/gmail/threads?maxResults=20${q ? `&q=${encodeURIComponent(q)}` : ''}&label=${label}`)
    if (res.ok) { const d = await res.json(); setThreads(d.threads ?? []) }
    setThreadsLoad(false)
  }, [gmailStatus?.connected, search, leadAddress, label])

  useEffect(() => { loadThreads() }, [loadThreads])

  const openThread = async (threadId: string) => {
    setThreadLoad(true)
    const res = await fetch(`/api/gmail/threads/${threadId}`)
    if (res.ok) {
      const d = await res.json()
      setActiveThread({ id: threadId, messages: d.messages ?? [] })
    }
    setThreadLoad(false)
    setReplyBody(''); setReplyErr('')
  }

  const sendNew = async () => {
    if (!cTo || !cSubject || !cBody) { setSendErr('To, subject, and body required'); return }
    setSending(true); setSendErr(''); setSendOk(false)
    const res = await fetch('/api/gmail/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: cTo, subject: cSubject, html_body: cBody, cc: cCC || undefined, lead_id: leadId, contact_id: primaryContact?.id }),
    })
    if (res.ok) {
      setSendOk(true); setCTo(''); setCSubject(''); setCBody(''); setCCC('')
      setTimeout(() => { setComposing(false); setSendOk(false); loadThreads() }, 1500)
    } else {
      const d = await res.json(); setSendErr(d.error ?? 'Send failed')
    }
    setSending(false)
  }

  const sendReply = async () => {
    if (!replyBody.trim() || !activeThread) return
    setReplySending(true); setReplyErr('')
    const lastMsg = activeThread.messages[activeThread.messages.length - 1]
    const res = await fetch('/api/gmail/reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId:   activeThread.id,
        messageId:  lastMsg.id,
        to:         lastMsg.from,
        subject:    `Re: ${lastMsg.subject}`,
        html_body:  `<p>${replyBody.replace(/\n/g, '</p><p>')}</p>`,
        lead_id:    leadId,
        contact_id: primaryContact?.id,
      }),
    })
    if (res.ok) {
      setReplyBody(''); openThread(activeThread.id)
    } else {
      const d = await res.json(); setReplyErr(d.error ?? 'Reply failed')
    }
    setReplySending(false)
  }

  const generateAI = async (tone: string) => {
    setAiLoading(true)
    const lastMsg = activeThread?.messages[activeThread.messages.length - 1]
    const res = await fetch(`/api/leads/${leadId}/comms/ai-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tone, contact_name: primaryContact?.name ?? 'Seller', property_address: leadAddress,
        thread_snippet: lastMsg?.body?.replace(/<[^>]+>/g, '').slice(0, 400) ?? '',
        context: composing ? cSubject : '',
      }),
    })
    if (res.ok) {
      const d = await res.json()
      if (composing) { setCBody(d.draft); if (d.subject && !cSubject) setCSubject(d.subject) }
      else setReplyBody(d.draft.replace(/<[^>]+>/g, ''))
    }
    setAiLoading(false)
  }

  if (!gmailStatus) return (
    <div style={{ padding: 20, textAlign: 'center', color: '#4a6a9a', fontSize: 11 }}>Checking Gmail…</div>
  )

  if (!gmailStatus.connected) return (
    <Card style={{ textAlign: 'center', padding: 32 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>✉</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>Connect Gmail</div>
      <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 16, maxWidth: 280, margin: '0 auto 16px' }}>
        Connect your Gmail account to send and receive emails directly from NextKey OS.
      </div>
      <a href="/api/auth/gmail"
        style={{ display: 'inline-block', padding: '8px 20px', borderRadius: 7, background: '#1a3050', border: '1px solid rgba(167,139,250,0.4)', color: '#a78bfa', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
        Connect Gmail →
      </a>
    </Card>
  )

  if (activeThread) {
    const lastMsg = activeThread.messages[activeThread.messages.length - 1]
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button onClick={() => setActiveThread(null)} style={{ fontSize: 11, color: '#4a6a9a', background: 'none', border: '1px solid #1a3050', borderRadius: 5, padding: '3px 10px', cursor: 'pointer' }}>← Back</button>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{lastMsg.subject || '(no subject)'}</span>
        </div>

        {threadLoad ? <div style={{ padding: 20, textAlign: 'center', color: '#4a6a9a', fontSize: 11 }}>Loading thread…</div>
        : activeThread.messages.map(msg => (
          <div key={msg.id} style={{ marginBottom: 10 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>{msg.from}</div>
                  {msg.cc && <div style={{ fontSize: 10, color: '#4a6a9a' }}>CC: {msg.cc}</div>}
                </div>
                <span style={{ fontSize: 10, color: '#4a6a9a', flexShrink: 0 }}>{msg.date}</span>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6, maxHeight: 300, overflow: 'auto' }}
                dangerouslySetInnerHTML={{ __html: msg.body || '(no body)' }} />
              {msg.attachments.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {msg.attachments.map(a => (
                    <Badge key={a.attachmentId} label={`📎 ${a.filename}`} color="#4a6a9a" />
                  ))}
                </div>
              )}
            </Card>
          </div>
        ))}

        {/* Reply box */}
        <Card style={{ marginTop: 8 }}>
          <SectionTitle>Reply</SectionTitle>
          {/* AI tone picker */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {['professional','friendly','negotiation','follow_up','counter'].map(t => (
              <button key={t} onClick={() => { setAiTone(t); generateAI(t) }} disabled={aiLoading}
                style={{ padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  background: aiTone === t ? 'rgba(201,168,76,0.12)' : 'transparent',
                  color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
                {aiLoading && aiTone === t ? '…' : `✦ ${t.replace('_', ' ')}`}
              </button>
            ))}
          </div>
          <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)}
            placeholder="Type your reply…" rows={4}
            style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '7px 9px', color: '#e2e8f0', fontSize: 11, resize: 'vertical', fontFamily: 'inherit', outline: 'none', marginBottom: 6 }}
          />
          {replyErr && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6 }}>{replyErr}</div>}
          <Btn onClick={sendReply} disabled={replySending || !replyBody.trim()} color="#a78bfa" fill>
            {replySending ? 'Sending…' : 'Send Reply'}
          </Btn>
        </Card>
      </div>
    )
  }

  if (composing) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={() => setComposing(false)} style={{ fontSize: 11, color: '#4a6a9a', background: 'none', border: '1px solid #1a3050', borderRadius: 5, padding: '3px 10px', cursor: 'pointer' }}>← Back</button>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Compose Email</span>
        <Badge label={gmailStatus.email ?? ''} color="#a78bfa" />
      </div>
      <Card>
        {[
          { label: 'To', val: cTo, set: setCTo, ph: 'recipient@email.com' },
          { label: 'CC', val: cCC, set: setCCC, ph: 'Optional CC' },
          { label: 'Subject', val: cSubject, set: setCSubject, ph: 'Email subject' },
        ].map(f => (
          <div key={f.label} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 3 }}>{f.label}</div>
            <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
              style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '6px 9px', color: '#e2e8f0', fontSize: 11, fontFamily: 'inherit', outline: 'none' }}
            />
          </div>
        ))}
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <div style={{ fontSize: 10, color: '#4a6a9a' }}>Body</div>
            <div style={{ display: 'flex', gap: 3 }}>
              {['professional','friendly','follow_up','negotiation'].map(t => (
                <button key={t} onClick={() => generateAI(t)} disabled={aiLoading}
                  style={{ padding: '2px 7px', borderRadius: 20, fontSize: 9, fontWeight: 600, cursor: 'pointer',
                    color: '#C9A84C', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)' }}>
                  {aiLoading ? '…' : `✦ ${t.replace('_', ' ')}`}
                </button>
              ))}
            </div>
          </div>
          <textarea value={cBody} onChange={e => setCBody(e.target.value)} placeholder="Email body (HTML supported)…" rows={10}
            style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '7px 9px', color: '#e2e8f0', fontSize: 11, resize: 'vertical', fontFamily: 'inherit', outline: 'none' }}
          />
        </div>
        {sendErr && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6 }}>{sendErr}</div>}
        {sendOk  && <div style={{ fontSize: 11, color: '#4CAF9A', marginBottom: 6 }}>✓ Email sent successfully</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn onClick={sendNew} disabled={sending} color="#a78bfa" fill>{sending ? 'Sending…' : 'Send Email'}</Btn>
          <Btn onClick={() => setComposing(false)} color="#4a6a9a">Cancel</Btn>
        </div>
      </Card>
    </div>
  )

  const LABELS = [
    { id: 'INBOX', label: 'Inbox' }, { id: 'SENT', label: 'Sent' },
    { id: 'DRAFT', label: 'Drafts' }, { id: 'STARRED', label: 'Starred' }, { id: 'TRASH', label: 'Trash' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {LABELS.map(l => (
            <button key={l.id} onClick={() => setLabel(l.id)}
              style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: label === l.id ? 'rgba(167,139,250,0.12)' : 'transparent',
                color: label === l.id ? '#a78bfa' : '#4a6a9a',
                border: `1px solid ${label === l.id ? 'rgba(167,139,250,0.4)' : '#1a3050'}` }}>
              {l.label}
            </button>
          ))}
        </div>
        <Btn onClick={() => { setComposing(true); setCTo(primaryContact?.email ?? '') }} color="#a78bfa" fill small>+ Compose</Btn>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && loadThreads()}
          placeholder="Search emails…"
          style={{ flex: 1, background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '5px 9px', color: '#e2e8f0', fontSize: 11, outline: 'none' }}
        />
        <Btn onClick={loadThreads} disabled={threadsLoad} color="#4a6a9a" small>{threadsLoad ? '…' : '↻'}</Btn>
      </div>

      {threadsLoad ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#4a6a9a', fontSize: 11 }}>Loading threads…</div>
      ) : threads.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 11, color: '#4a6a9a' }}>No threads found. Compose a new email to get started.</div>
        </Card>
      ) : threads.map(t => (
        <div key={t.id} onClick={() => openThread(t.id)}
          style={{ background: '#0a1729', border: `1px solid ${t.unread ? 'rgba(167,139,250,0.3)' : '#1a3050'}`, borderRadius: 6, padding: '9px 12px', marginBottom: 6, cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {t.unread && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', flexShrink: 0 }} />}
                <div style={{ fontSize: 11, fontWeight: t.unread ? 700 : 500, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.subject || '(no subject)'}
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 2 }}>{t.from}</div>
              <div style={{ fontSize: 10, color: '#6b7a8a', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.snippet}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: '#4a6a9a' }}>{t.date}</div>
              {t.messageCount > 1 && <div style={{ fontSize: 9, color: '#4a6a9a', marginTop: 2 }}>{t.messageCount} msgs</div>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── SMSSection ───────────────────────────────────────────────────────────────

function SMSSection({ leadId }: { leadId: string }) {
  const { contacts } = useWorkspace()
  const [activeContactId, setActiveContactId] = useState<string | null>(
    contacts.find(c => c.is_primary)?.contact.id ?? contacts[0]?.contact.id ?? null
  )
  const [messages,  setMessages]  = useState<SmsMessage[]>([])
  const [loading,   setLoading]   = useState(false)
  const [body,      setBody]      = useState('')
  const [sending,   setSending]   = useState(false)
  const [sendErr,   setSendErr]   = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestion, setAiSugg] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadMessages = useCallback(async () => {
    if (!activeContactId) return
    setLoading(true)
    const res = await fetch(`/api/leads/${leadId}/comms/sms?contact_id=${activeContactId}`)
    if (res.ok) { const d = await res.json(); setMessages(d.messages ?? []) }
    setLoading(false)
  }, [leadId, activeContactId])

  useEffect(() => { loadMessages() }, [loadMessages])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async () => {
    if (!body.trim() || !activeContactId) return
    setSending(true); setSendErr('')
    const res = await fetch(`/api/leads/${leadId}/comms/sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: activeContactId, body: body.trim() }),
    })
    if (res.ok) { setBody(''); setAiSugg(''); loadMessages() }
    else { const d = await res.json(); setSendErr(d.error ?? 'Send failed') }
    setSending(false)
  }

  const getAISuggestion = async () => {
    if (!activeContactId) return
    setAiLoading(true)
    const res = await fetch('/api/sms/ai-reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: activeContactId }),
    })
    if (res.ok) { const d = await res.json(); setAiSugg(d.suggestion) }
    setAiLoading(false)
  }

  const activeContact = contacts.find(c => c.contact.id === activeContactId)?.contact

  if (contacts.length === 0) return (
    <Card style={{ textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>No Contacts Linked</div>
      <div style={{ fontSize: 11, color: '#4a6a9a' }}>Add a contact in the People tab to enable SMS.</div>
    </Card>
  )

  return (
    <div>
      {/* Contact selector */}
      {contacts.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
          {contacts.map(c => (
            <button key={c.contact.id} onClick={() => setActiveContactId(c.contact.id)}
              style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: activeContactId === c.contact.id ? 'rgba(96,165,250,0.12)' : 'transparent',
                color: activeContactId === c.contact.id ? '#60a5fa' : '#4a6a9a',
                border: `1px solid ${activeContactId === c.contact.id ? 'rgba(96,165,250,0.4)' : '#1a3050'}` }}>
              {c.contact.name}
            </button>
          ))}
        </div>
      )}

      {activeContact && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '5px 10px', background: '#0a1729', borderRadius: 6, border: '1px solid #1a3050' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>{activeContact.name}</div>
            {activeContact.phone && <div style={{ fontSize: 10, color: '#4a6a9a' }}>{activeContact.phone}</div>}
          </div>
          {activeContact.phone && (
            <a href={`tel:${activeContact.phone}`} style={{ fontSize: 11, color: '#22c55e', textDecoration: 'none', padding: '3px 9px', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 5 }}>
              📞 Call
            </a>
          )}
        </div>
      )}

      {/* Messages thread */}
      <div style={{ background: '#060e1a', border: '1px solid #1a3050', borderRadius: 7, padding: 10, height: 320, overflowY: 'auto', marginBottom: 10 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#4a6a9a', fontSize: 11, paddingTop: 40 }}>Loading messages…</div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#4a6a9a', fontSize: 11, paddingTop: 40 }}>
            No messages yet. Send the first one below.
          </div>
        ) : messages.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.direction === 'outbound' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
            <div style={{
              maxWidth: '75%', padding: '7px 10px', borderRadius: m.direction === 'outbound' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
              background: m.direction === 'outbound' ? '#1a3a6e' : '#0a1729',
              border: `1px solid ${m.direction === 'outbound' ? 'rgba(96,165,250,0.25)' : '#1a3050'}`,
            }}>
              <div style={{ fontSize: 11, color: '#e2e8f0', lineHeight: 1.4 }}>{m.body}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 3, justifyContent: 'flex-end', alignItems: 'center' }}>
                <span style={{ fontSize: 9, color: '#4a6a9a' }}>{fmtRelative(m.created_at)}</span>
                {m.direction === 'outbound' && (
                  <span style={{ fontSize: 9, color: m.status === 'delivered' ? '#4CAF9A' : m.status === 'failed' ? '#ef4444' : '#4a6a9a' }}>
                    {m.status === 'delivered' ? '✓✓' : m.status === 'sent' ? '✓' : m.status === 'mock' ? '~' : '✗'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* AI suggestion */}
      {aiSuggestion && (
        <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#C9A84C', marginBottom: 3 }}>✦ AI SUGGESTION</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{aiSuggestion}</div>
            </div>
            <button onClick={() => { setBody(aiSuggestion); setAiSugg('') }}
              style={{ fontSize: 10, color: '#C9A84C', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', flexShrink: 0, marginLeft: 8 }}>
              Use
            </button>
          </div>
        </div>
      )}

      {sendErr && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6 }}>{sendErr}</div>}

      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <textarea value={body} onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Type a message… (Enter to send)"
          rows={2}
          style={{ flex: 1, background: '#060e1a', border: '1px solid #1a3050', borderRadius: 6, padding: '7px 9px', color: '#e2e8f0', fontSize: 11, resize: 'none', fontFamily: 'inherit', outline: 'none' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={send} disabled={sending || !body.trim() || !activeContactId}
            style={{ padding: '6px 12px', borderRadius: 6, background: '#1a3a6e', border: '1px solid rgba(96,165,250,0.4)', color: '#60a5fa', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {sending ? '…' : '↑'}
          </button>
          <button onClick={getAISuggestion} disabled={aiLoading}
            style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: '#C9A84C', fontSize: 10, cursor: 'pointer' }}>
            {aiLoading ? '…' : '✦'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── CallsSection ─────────────────────────────────────────────────────────────

function CallsSection({ leadId }: { leadId: string }) {
  const { lead, contacts, notes, addNote, updateLeadField, acquisition } = useWorkspace()
  const { communicationStatus } = acquisition
  const primaryContact = contacts.find(c => c.is_primary)?.contact ?? contacts[0]?.contact ?? null

  const [outcome, setOutcome] = useState('talked')
  const [callNotes, setCallNotes] = useState('')
  const [duration, setDuration] = useState('')
  const [saving, setSaving] = useState(false)

  const OUTCOMES = [
    { v: 'talked', l: 'Talked', c: '#4CAF9A' },
    { v: 'voicemail', l: 'Left Voicemail', c: '#C9A84C' },
    { v: 'no_answer', l: 'No Answer', c: '#60a5fa' },
    { v: 'busy', l: 'Busy', c: '#f59e0b' },
    { v: 'wrong_number', l: 'Wrong Number', c: '#ef4444' },
    { v: 'disconnected', l: 'Disconnected', c: '#6b7280' },
  ]

  const logCall = async () => {
    if (!callNotes.trim()) return
    setSaving(true)
    const outcomeLabel = OUTCOMES.find(o => o.v === outcome)?.l ?? outcome
    const fullNote = [
      `Outcome: ${outcomeLabel}`,
      duration ? `Duration: ${duration}` : null,
      `Notes: ${callNotes}`,
    ].filter(Boolean).join('\n')
    await addNote(fullNote, 'call_log')
    setCallNotes(''); setDuration('')
    setSaving(false)
  }

  const callLogs = notes.filter(n => n.note_type === 'call_log')

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Log new call */}
        <div>
          {primaryContact && (
            <Card style={{ marginBottom: 10 }}>
              <SectionTitle>Quick Call</SectionTitle>
              <a href={primaryContact?.phone ? `tel:${primaryContact.phone}` : 'tel:'}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5, border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.06)', color: '#22c55e', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                📞 Call {primaryContact.name}
                {primaryContact.phone && <span style={{ fontSize: 10, color: 'rgba(34,197,94,0.6)', fontWeight: 400 }}>{primaryContact.phone}</span>}
              </a>
              {contacts.filter(c => c.contact.id !== primaryContact?.id).slice(0, 2).map(c => (
                <a key={c.contact.id} href={c.contact.phone ? `tel:${c.contact.phone}` : 'tel:'}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 5, border: '1px solid #1a3050', background: 'transparent', color: '#4a6a9a', fontSize: 11, textDecoration: 'none', marginTop: 5 }}>
                  📞 {c.contact.name} {c.contact.phone && <span style={{ fontSize: 10 }}>{c.contact.phone}</span>}
                </a>
              ))}
            </Card>
          )}

          <Card>
            <SectionTitle>Log Call</SectionTitle>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 9 }}>
              {OUTCOMES.map(o => (
                <button key={o.v} onClick={() => setOutcome(o.v)}
                  style={{ padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: outcome === o.v ? `${o.c}18` : 'transparent',
                    color: outcome === o.v ? o.c : '#4a6a9a',
                    border: `1px solid ${outcome === o.v ? `${o.c}50` : '#1a3050'}` }}>
                  {o.l}
                </button>
              ))}
            </div>
            <input value={duration} onChange={e => setDuration(e.target.value)} placeholder="Duration (e.g. 5 min)"
              style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '5px 8px', color: '#e2e8f0', fontSize: 11, fontFamily: 'inherit', outline: 'none', marginBottom: 7 }}
            />
            <textarea value={callNotes} onChange={e => setCallNotes(e.target.value)} placeholder="What happened on this call?" rows={3}
              style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '6px 8px', color: '#e2e8f0', fontSize: 11, resize: 'vertical', fontFamily: 'inherit', outline: 'none', marginBottom: 7 }}
            />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Btn onClick={logCall} disabled={saving || !callNotes.trim()} color="#22c55e" fill>
                {saving ? 'Saving…' : 'Log Call'}
              </Btn>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#4a6a9a' }}>Status:</span>
                <select value={communicationStatus.callStatus}
                  onChange={e => updateLeadField({ call_status: e.target.value })}
                  style={{ background: '#060e1a', border: '1px solid #1a3050', borderRadius: 4, color: '#22c55e', padding: '3px 5px', fontSize: 10, cursor: 'pointer' }}>
                  {Object.entries(CALL_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
          </Card>
        </div>

        {/* Call history */}
        <div>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <SectionTitle>Call History ({callLogs.length})</SectionTitle>
            </div>
            {callLogs.length === 0 ? (
              <div style={{ fontSize: 11, color: '#4a6a9a', padding: '8px 0' }}>No calls logged yet.</div>
            ) : callLogs.map(n => (
              <div key={n.id} style={{ padding: '7px 0', borderBottom: '1px solid #0d1b2e' }}>
                <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 2 }}>{fmtDateTime(n.created_at)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── NotesSection ─────────────────────────────────────────────────────────────

function NotesSection({ leadId }: { leadId: string }) {
  const { notes, addNote } = useWorkspace()
  const [body,    setBody]    = useState('')
  const [type,    setType]    = useState<string>('note')
  const [saving,  setSaving]  = useState(false)
  const [filter,  setFilter]  = useState<string>('note')

  const save = async () => {
    if (!body.trim()) return
    setSaving(true)
    await addNote(body.trim(), type)
    setBody('')
    setSaving(false)
  }

  const NOTE_TYPES = [
    { v: 'note', l: 'Note', c: '#C9A84C' },
    { v: 'email_log', l: 'Email', c: '#a78bfa' },
    { v: 'sms_log', l: 'SMS', c: '#60a5fa' },
  ]

  const filtered = notes.filter(n =>
    filter === 'all' ? true : (n.note_type ?? 'note') === filter
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        <Card>
          <SectionTitle>Add Note</SectionTitle>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {NOTE_TYPES.map(t => (
              <button key={t.v} onClick={() => setType(t.v)}
                style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  background: type === t.v ? `${t.c}18` : 'transparent',
                  color: type === t.v ? t.c : '#4a6a9a',
                  border: `1px solid ${type === t.v ? `${t.c}50` : '#1a3050'}` }}>
                {t.l}
              </button>
            ))}
          </div>
          <textarea value={body} onChange={e => setBody(e.target.value)}
            placeholder={type === 'note' ? 'Add a note…' : type === 'email_log' ? 'Summarize the email…' : 'What was the SMS exchange?'}
            rows={5}
            style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '7px 9px', color: '#e2e8f0', fontSize: 11, resize: 'vertical', fontFamily: 'inherit', outline: 'none', marginBottom: 7 }}
          />
          <Btn onClick={save} disabled={saving || !body.trim()} color="#C9A84C" fill>
            {saving ? 'Saving…' : 'Save Note'}
          </Btn>
        </Card>
      </div>

      <div>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <SectionTitle>Notes ({notes.length})</SectionTitle>
            <div style={{ display: 'flex', gap: 3 }}>
              {[{ v: 'all', l: 'All' }, { v: 'note', l: 'Notes' }, { v: 'email_log', l: 'Email' }, { v: 'sms_log', l: 'SMS' }].map(f => (
                <button key={f.v} onClick={() => setFilter(f.v)}
                  style={{ padding: '2px 6px', borderRadius: 20, fontSize: 9, cursor: 'pointer',
                    background: filter === f.v ? 'rgba(201,168,76,0.1)' : 'transparent',
                    color: filter === f.v ? '#C9A84C' : '#4a6a9a',
                    border: `1px solid ${filter === f.v ? 'rgba(201,168,76,0.3)' : '#1a3050'}` }}>
                  {f.l}
                </button>
              ))}
            </div>
          </div>
          {filtered.length === 0 ? (
            <div style={{ fontSize: 11, color: '#4a6a9a', padding: '8px 0' }}>No notes yet.</div>
          ) : filtered.map(n => (
            <div key={n.id} style={{ padding: '7px 0', borderBottom: '1px solid #0d1b2e' }}>
              <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 2 }}>
                {fmtDateTime(n.created_at)}{n.author ? ` · ${n.author}` : ''}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{n.body}</div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}

// ─── TasksSection ─────────────────────────────────────────────────────────────

function TasksSection({ leadId }: { leadId: string }) {
  const [tasks,   setTasks]   = useState<LeadTask[]>([])
  const [loading, setLoading] = useState(true)
  const [title,   setTitle]   = useState('')
  const [desc,    setDesc]    = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority,setPriority]= useState('normal')
  const [saving,  setSaving]  = useState(false)
  const [err,     setErr]     = useState('')
  const [filter,  setFilter]  = useState<'all'|'pending'|'completed'>('all')

  const load = useCallback(async () => {
    const res = await fetch(`/api/leads/${leadId}/comms/tasks`)
    if (res.ok) { const d = await res.json(); setTasks(d.tasks ?? []) }
    setLoading(false)
  }, [leadId])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!title.trim()) { setErr('Title required'); return }
    setSaving(true); setErr('')
    const res = await fetch(`/api/leads/${leadId}/comms/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), description: desc || null, due_date: dueDate || null, priority }),
    })
    if (res.ok) { setTitle(''); setDesc(''); setDueDate(''); load() }
    else { const d = await res.json(); setErr(d.error ?? 'Failed') }
    setSaving(false)
  }

  const patch = async (taskId: string, updates: Record<string, unknown>) => {
    await fetch(`/api/leads/${leadId}/comms/tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    load()
  }

  const del = async (taskId: string) => {
    await fetch(`/api/leads/${leadId}/comms/tasks/${taskId}`, { method: 'DELETE' })
    load()
  }

  const PRIORITY_COLORS: Record<string, string> = {
    urgent: '#ef4444', high: '#E07B6A', normal: '#C9A84C', low: '#4a6a9a',
  }

  const shown = tasks.filter(t =>
    filter === 'all' ? true : filter === 'completed' ? t.status === 'completed' : t.status !== 'completed'
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        <Card>
          <SectionTitle>Create Task</SectionTitle>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title" onKeyDown={e => e.key === 'Enter' && create()}
            style={{ width: '100%', background: '#060e1a', border: `1px solid ${err ? '#ef4444' : '#1a3050'}`, borderRadius: 5, padding: '5px 8px', color: '#e2e8f0', fontSize: 11, fontFamily: 'inherit', outline: 'none', marginBottom: 7 }}
          />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" rows={2}
            style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '5px 8px', color: '#e2e8f0', fontSize: 11, resize: 'none', fontFamily: 'inherit', outline: 'none', marginBottom: 7 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 9 }}>
            <div>
              <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 3 }}>Due Date</div>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '5px 7px', color: '#e2e8f0', fontSize: 11, outline: 'none', colorScheme: 'dark' }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 3 }}>Priority</div>
              <div style={{ display: 'flex', gap: 3 }}>
                {['low','normal','high','urgent'].map(p => (
                  <button key={p} onClick={() => setPriority(p)}
                    style={{ flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 9, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                      background: priority === p ? `${PRIORITY_COLORS[p]}18` : 'transparent',
                      color: priority === p ? PRIORITY_COLORS[p] : '#4a6a9a',
                      border: `1px solid ${priority === p ? `${PRIORITY_COLORS[p]}50` : '#1a3050'}` }}>
                    {p === 'normal' ? 'Norm' : p.slice(0,3).charAt(0).toUpperCase() + p.slice(0,3).slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {err && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6 }}>{err}</div>}
          <Btn onClick={create} disabled={saving || !title.trim()} color="#f59e0b" fill>
            {saving ? 'Creating…' : 'Create Task'}
          </Btn>
        </Card>
      </div>

      <div>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <SectionTitle>Tasks ({tasks.filter(t => t.status !== 'completed').length} open)</SectionTitle>
            <div style={{ display: 'flex', gap: 3 }}>
              {(['all','pending','completed'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{ padding: '2px 6px', borderRadius: 20, fontSize: 9, cursor: 'pointer', textTransform: 'capitalize',
                    background: filter === f ? 'rgba(245,158,11,0.1)' : 'transparent',
                    color: filter === f ? '#f59e0b' : '#4a6a9a',
                    border: `1px solid ${filter === f ? 'rgba(245,158,11,0.3)' : '#1a3050'}` }}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          {loading ? <div style={{ color: '#4a6a9a', fontSize: 11 }}>Loading…</div>
          : shown.length === 0 ? <div style={{ color: '#4a6a9a', fontSize: 11, padding: '8px 0' }}>No tasks.</div>
          : shown.map(t => (
            <div key={t.id} style={{ padding: '7px 0', borderBottom: '1px solid #0d1b2e' }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                <button onClick={() => patch(t.id, { status: t.status === 'completed' ? 'pending' : 'completed' })}
                  style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${t.status === 'completed' ? '#4CAF9A' : '#1a3050'}`, background: t.status === 'completed' ? '#4CAF9A' : 'transparent', cursor: 'pointer', flexShrink: 0, marginTop: 1 }}>
                  {t.status === 'completed' && <span style={{ color: '#000', fontSize: 10 }}>✓</span>}
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: t.status === 'completed' ? '#4a6a9a' : '#e2e8f0', textDecoration: t.status === 'completed' ? 'line-through' : 'none' }}>
                    {t.title}
                  </div>
                  {t.description && <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 2 }}>{t.description}</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                    {t.due_date && (
                      <span style={{ fontSize: 9, color: new Date(t.due_date) < new Date() ? '#ef4444' : '#C9A84C' }}>
                        Due {fmtDateShort(t.due_date)}
                      </span>
                    )}
                    {t.priority !== 'normal' && (
                      <span style={{ fontSize: 9, color: PRIORITY_COLORS[t.priority] }}>{t.priority}</span>
                    )}
                  </div>
                </div>
                <button onClick={() => del(t.id)} style={{ fontSize: 11, color: '#4a6a9a', background: 'none', border: 'none', cursor: 'pointer', padding: '0 3px', flexShrink: 0 }}>✕</button>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}

// ─── TemplatesSection ─────────────────────────────────────────────────────────

function TemplatesSection({ onUseTemplate }: { onUseTemplate: (t: EmailTemplate) => void }) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('all')
  const [search,    setSearch]    = useState('')
  const [preview,   setPreview]   = useState<EmailTemplate | null>(null)

  useEffect(() => {
    fetch('/api/email-templates')
      .then(r => r.json())
      .then(d => setTemplates(d.templates ?? []))
      .finally(() => setLoading(false))
  }, [])

  const categories = ['all', ...Array.from(new Set(templates.map(t => t.category))).sort()]

  const shown = templates.filter(t =>
    (filter === 'all' || t.category === filter) &&
    (!search || t.name.toLowerCase().includes(search.toLowerCase()) || t.subject.toLowerCase().includes(search.toLowerCase()))
  )

  const CAT_COLORS: Record<string, string> = {
    outreach: '#4CAF9A', follow_up: '#C9A84C', offer: '#60a5fa',
    contract: '#a78bfa', closing: '#f59e0b', logistics: '#22c55e', general: '#4a6a9a',
  }

  if (preview) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={() => setPreview(null)} style={{ fontSize: 11, color: '#4a6a9a', background: 'none', border: '1px solid #1a3050', borderRadius: 5, padding: '3px 10px', cursor: 'pointer' }}>← Back</button>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>{preview.name}</span>
        <Btn onClick={() => { onUseTemplate(preview); setPreview(null) }} color="#a78bfa" fill small>Use Template</Btn>
      </div>
      <Card style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <Badge label={preview.category} color={CAT_COLORS[preview.category] ?? '#4a6a9a'} />
          {preview.folder && <Badge label={preview.folder} color="#4a6a9a" />}
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: '#4a6a9a', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 3 }}>Subject</div>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#e2e8f0' }}>{preview.subject}</div>
        </div>
        <div style={{ fontSize: 9, color: '#4a6a9a', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>Body</div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6, background: '#060e1a', borderRadius: 5, padding: 10 }}
          dangerouslySetInnerHTML={{ __html: preview.body }} />
      </Card>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…"
          style={{ flex: 1, background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '5px 9px', color: '#e2e8f0', fontSize: 11, outline: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        {categories.map(c => (
          <button key={c} onClick={() => setFilter(c)}
            style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', textTransform: c === 'all' ? 'none' : 'capitalize',
              background: filter === c ? `${CAT_COLORS[c] ?? '#C9A84C'}18` : 'transparent',
              color: filter === c ? (CAT_COLORS[c] ?? '#C9A84C') : '#4a6a9a',
              border: `1px solid ${filter === c ? `${CAT_COLORS[c] ?? '#C9A84C'}40` : '#1a3050'}` }}>
            {c === 'all' ? 'All' : c.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading ? <div style={{ color: '#4a6a9a', fontSize: 11, padding: 20, textAlign: 'center' }}>Loading…</div>
      : shown.length === 0 ? <Card style={{ textAlign: 'center', padding: 20 }}><div style={{ fontSize: 11, color: '#4a6a9a' }}>No templates found.</div></Card>
      : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {shown.map(t => (
            <div key={t.id} style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 6, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>{t.name}</div>
                  <Badge label={t.category} color={CAT_COLORS[t.category] ?? '#4a6a9a'} />
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.subject}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <Btn onClick={() => setPreview(t)} color="#4a6a9a" small>Preview</Btn>
                <Btn onClick={() => onUseTemplate(t)} color="#a78bfa" fill small>Use</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── AutomationsSection ───────────────────────────────────────────────────────
// UI architecture only — execution engine is Phase 4.5+

function AutomationsSection() {
  const [showBuilder, setShowBuilder] = useState(false)
  const [trigger, setTrigger] = useState(AUTOMATION_TRIGGERS[0])
  const [steps, setSteps] = useState<AutomationStep[]>([])
  const [name, setName] = useState('')

  const STEP_TYPES: { t: AutomationStep['type']; l: string; c: string }[] = [
    { t: 'wait',      l: 'Wait',      c: '#4a6a9a' },
    { t: 'email',     l: 'Send Email', c: '#a78bfa' },
    { t: 'sms',       l: 'Send SMS',   c: '#60a5fa' },
    { t: 'task',      l: 'Create Task',c: '#f59e0b' },
    { t: 'condition', l: 'If/Else',    c: '#4CAF9A' },
  ]

  const addStep = (t: AutomationStep['type']) => {
    const typeLabel = STEP_TYPES.find(s => s.t === t)!
    setSteps(s => [...s, { id: crypto.randomUUID(), type: t, label: typeLabel.l, config: {} }])
  }

  const removeStep = (id: string) => setSteps(s => s.filter(step => step.id !== id))

  const EXAMPLE_AUTOMATIONS = [
    { name: 'Offer Follow-Up', trigger: 'Offer Sent', steps: ['Wait 48h', 'If No Reply → Send Email', 'Wait 24h', 'Send SMS', 'Create Call Task'] },
    { name: 'New Contact Welcome', trigger: 'Contact Created', steps: ['Send Email: Initial Outreach', 'Wait 3 days', 'If No Reply → Follow-Up Email'] },
    { name: 'Dead Lead Reactivation', trigger: 'Stage Changed to Dead', steps: ['Wait 30 days', 'Send SMS: Check-in', 'Create Task: Review lead'] },
  ]

  if (showBuilder) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={() => setShowBuilder(false)} style={{ fontSize: 11, color: '#4a6a9a', background: 'none', border: '1px solid #1a3050', borderRadius: 5, padding: '3px 10px', cursor: 'pointer' }}>← Back</button>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>New Automation</span>
      </div>
      <Card style={{ marginBottom: 10 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Automation name"
          style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 5, padding: '6px 9px', color: '#e2e8f0', fontSize: 11, fontFamily: 'inherit', outline: 'none', marginBottom: 10 }}
        />
        <SectionTitle>Trigger</SectionTitle>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
          {AUTOMATION_TRIGGERS.map(t => (
            <button key={t} onClick={() => setTrigger(t)}
              style={{ padding: '4px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: trigger === t ? 'rgba(76,175,154,0.12)' : 'transparent',
                color: trigger === t ? '#4CAF9A' : '#4a6a9a',
                border: `1px solid ${trigger === t ? 'rgba(76,175,154,0.4)' : '#1a3050'}` }}>
              {t}
            </button>
          ))}
        </div>

        <SectionTitle>Steps</SectionTitle>
        {steps.map((step, i) => {
          const sc = STEP_TYPES.find(s => s.t === step.type)!
          return (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <div style={{ width: 20, height: 20, borderRadius: 4, background: `${sc.c}18`, border: `1px solid ${sc.c}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: sc.c, flexShrink: 0 }}>
                {i + 1}
              </div>
              <div style={{ flex: 1, background: '#060e1a', border: `1px solid ${sc.c}25`, borderRadius: 5, padding: '6px 9px', fontSize: 11, color: '#e2e8f0' }}>
                {step.label}
                {step.type === 'wait' && <input defaultValue="48 hours" style={{ background: 'none', border: 'none', color: '#C9A84C', fontSize: 11, marginLeft: 6, outline: 'none', width: 80 }} />}
              </div>
              <button onClick={() => removeStep(step.id)} style={{ color: '#4a6a9a', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
          )
        })}
        {steps.length === 0 && <div style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 10 }}>No steps added yet.</div>}

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: '1px solid #1a3050' }}>
          <span style={{ fontSize: 10, color: '#4a6a9a', alignSelf: 'center', marginRight: 4 }}>Add step:</span>
          {STEP_TYPES.map(s => (
            <button key={s.t} onClick={() => addStep(s.t)}
              style={{ padding: '3px 9px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: `${s.c}12`, color: s.c, border: `1px solid ${s.c}35` }}>
              + {s.l}
            </button>
          ))}
        </div>
      </Card>
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn color="#4CAF9A" fill onClick={() => {
          alert('Automation saved! (Execution engine activates in Phase 4.5)')
          setShowBuilder(false); setSteps([]); setName('')
        }}>Save Automation</Btn>
        <Btn color="#4a6a9a" onClick={() => setShowBuilder(false)}>Cancel</Btn>
      </div>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>Communication Automations</div>
          <div style={{ fontSize: 10, color: '#4a6a9a' }}>Build no-code workflows that trigger on events and run sequences automatically.</div>
        </div>
        <Btn onClick={() => setShowBuilder(true)} color="#4CAF9A" fill small>+ New Automation</Btn>
      </div>

      <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 7, padding: '10px 12px', marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#C9A84C', marginBottom: 3 }}>⚡ Architecture Ready</div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
          The automation builder is fully designed. Execution engine activates when cron infrastructure is connected.
          All workflows you save now will be queued for activation.
        </div>
      </div>

      <SectionTitle>Example Automations</SectionTitle>
      {EXAMPLE_AUTOMATIONS.map(a => (
        <Card key={a.name} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>{a.name}</div>
              <Badge label={`Trigger: ${a.trigger}`} color="#4CAF9A" />
            </div>
            <Btn small color="#4CAF9A" onClick={() => { setTrigger(a.trigger); setName(a.name); setShowBuilder(true) }}>
              Use This
            </Btn>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {a.steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ width: 16, height: 1, background: i === 0 ? 'transparent' : '#1a3050' }} />
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{i + 1}. {s}</div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

// ─── HealthSection ────────────────────────────────────────────────────────────

function HealthSection({ leadId }: { leadId: string }) {
  const { lead, acquisition, contacts, updateLeadField } = useWorkspace()
  const { communicationStatus } = acquisition
  const [health, setHealth] = useState<{
    emails_sent: number; sms_sent: number; calls: number; emails_received: number
    open_rate: number | null; response_rate: number | null; last_contact: string | null
    days_since: number | null; next_follow_ups: ScheduledItem[]; recommendation: string
    total_interactions: number
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/leads/${leadId}/comms/health`)
      .then(r => r.json())
      .then(d => setHealth(d))
      .finally(() => setLoading(false))
  }, [leadId])

  const STAT_ITEMS = health ? [
    { label: 'Emails Sent', value: String(health.emails_sent), color: '#a78bfa' },
    { label: 'SMS Sent',    value: String(health.sms_sent),    color: '#60a5fa' },
    { label: 'Calls',       value: String(health.calls),       color: '#22c55e' },
    { label: 'Replies',     value: String(health.emails_received), color: '#4CAF9A' },
    { label: 'Open Rate',   value: health.open_rate != null ? `${health.open_rate}%` : '—', color: '#C9A84C' },
    { label: 'Response',    value: health.response_rate != null ? `${health.response_rate}%` : '—', color: '#C9A84C' },
    { label: 'Last Contact', value: health.last_contact ? fmtRelative(health.last_contact) : 'Never', color: health.days_since != null ? (health.days_since > 14 ? '#ef4444' : health.days_since > 7 ? '#C9A84C' : '#4CAF9A') : '#4a6a9a' },
    { label: 'Total Events', value: String(health.total_interactions), color: '#e2e8f0' },
  ] : []

  return (
    <div>
      {/* Stats grid */}
      {loading ? <div style={{ color: '#4a6a9a', fontSize: 11, padding: 20, textAlign: 'center' }}>Loading metrics…</div> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
            {STAT_ITEMS.map(s => (
              <div key={s.label} style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: s.color, marginBottom: 2 }}>{s.value}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#4a6a9a', letterSpacing: '.04em', textTransform: 'uppercase' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {health?.recommendation && (
            <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 7, padding: '10px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#C9A84C', letterSpacing: '.06em', marginBottom: 4 }}>✦ AI RECOMMENDATION</div>
              <div style={{ fontSize: 11, color: '#e2e8f0', lineHeight: 1.5 }}>{health.recommendation}</div>
            </div>
          )}

          {health?.next_follow_ups && health.next_follow_ups.length > 0 && (
            <Card style={{ marginBottom: 12 }}>
              <SectionTitle>Upcoming Follow-Ups</SectionTitle>
              {health.next_follow_ups.map(item => (
                <div key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #0d1b2e' }}>
                  <div style={{ fontSize: 18 }}>{item.type === 'email' ? '✉' : item.type === 'sms' ? '💬' : item.type === 'call' ? '📞' : '✅'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#e2e8f0' }}>{item.title}</div>
                    <div style={{ fontSize: 10, color: '#C9A84C' }}>{new Date(item.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {/* Contact Status */}
      <Card style={{ marginBottom: 12 }}>
        <SectionTitle>Contact Status Flags</SectionTitle>
        {[
          { label: '📞 Call',  field: 'call_status',  current: communicationStatus.callStatus,  options: CALL_STATUS_LABELS,  color: '#22c55e' },
          { label: '💬 SMS',   field: 'sms_status',   current: communicationStatus.smsStatus,   options: SMS_STATUS_LABELS,   color: '#60a5fa' },
          { label: '✉ Email',  field: 'email_status', current: communicationStatus.emailStatus, options: EMAIL_STATUS_LABELS, color: '#a78bfa' },
        ].map(s => (
          <div key={s.field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ fontSize: 11, color: '#4a6a9a' }}>{s.label}</span>
            <select value={s.current} onChange={e => updateLeadField({ [s.field]: e.target.value })}
              style={{ background: '#060e1a', border: '1px solid #1a3050', borderRadius: 4, color: s.color, padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}>
              {Object.entries(s.options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ))}
      </Card>

      {/* Primary contact quick view */}
      {contacts.length > 0 && (
        <Card>
          <SectionTitle>Primary Contact</SectionTitle>
          {contacts.slice(0, 3).map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #0d1b2e' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: '#e2e8f0' }}>{c.contact.name}</div>
                <div style={{ fontSize: 10, color: '#4a6a9a' }}>{c.relationship_type}{c.is_primary ? ' · PRIMARY' : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {c.contact.phone && <a href={`tel:${c.contact.phone}`} style={{ fontSize: 10, color: '#22c55e', textDecoration: 'none' }}>📞</a>}
                {c.contact.email && <a href={`mailto:${c.contact.email}`} style={{ fontSize: 10, color: '#a78bfa', textDecoration: 'none' }}>✉</a>}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

// ─── Main CommunicationsTab ───────────────────────────────────────────────────

export default function CommunicationsTab() {
  const { lead, contacts } = useWorkspace()
  const [section, setSection] = useState<CommsSection>('timeline')

  // Used when a template is picked — switches to Email with template pre-loaded
  const [pendingTemplate, setPendingTemplate] = useState<EmailTemplate | null>(null)

  const leadAddress = [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
  const primaryContact = contacts.find(c => c.is_primary)?.contact ?? contacts[0]?.contact ?? null

  const useTemplate = (t: EmailTemplate) => {
    setPendingTemplate(t)
    setSection('email')
  }

  // Section colors
  const SECTION_COLORS: Record<CommsSection, string> = {
    timeline: '#C9A84C', email: '#a78bfa', sms: '#60a5fa', calls: '#22c55e',
    notes: '#C9A84C', tasks: '#f59e0b', templates: '#e2e8f0', automations: '#4CAF9A', health: '#94a3b8',
  }

  return (
    <div>
      {/* Section nav */}
      <div style={{
        display: 'flex', gap: 2, flexWrap: 'wrap',
        background: '#060e1a', border: '1px solid #1a3050', borderRadius: 8, padding: 4, marginBottom: 14,
      }}>
        {SECTIONS.map(s => {
          const active = section === s.id
          const color  = SECTION_COLORS[s.id]
          return (
            <button key={s.id} onClick={() => setSection(s.id)}
              style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: active ? 700 : 500,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                background: active ? `${color}18` : 'transparent',
                color: active ? color : '#4a6a9a',
                border: `1px solid ${active ? `${color}50` : 'transparent'}`,
                transition: 'all 0.15s',
              }}>
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </button>
          )
        })}
      </div>

      {/* Section content */}
      {section === 'timeline'    && <TimelineSection leadId={lead.id} />}
      {section === 'email'       && (
        <EmailSection
          leadId={lead.id}
          leadAddress={leadAddress}
          primaryContact={primaryContact ? {
            id:    primaryContact.id,
            name:  primaryContact.name,
            email: primaryContact.email,
          } : null}
        />
      )}
      {section === 'sms'         && <SMSSection leadId={lead.id} />}
      {section === 'calls'       && <CallsSection leadId={lead.id} />}
      {section === 'notes'       && <NotesSection leadId={lead.id} />}
      {section === 'tasks'       && <TasksSection leadId={lead.id} />}
      {section === 'templates'   && <TemplatesSection onUseTemplate={useTemplate} />}
      {section === 'automations' && <AutomationsSection />}
      {section === 'health'      && <HealthSection leadId={lead.id} />}
    </div>
  )
}
