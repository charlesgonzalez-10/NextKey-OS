'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

const EmailPanel = dynamic(() => import('./email-panel'), { ssr: false })

interface Convo {
  contactId: string
  contactName: string
  contactPhone: string
  lastMessage: string
  lastDirection: string
  lastAt: string
  unread: boolean
}

interface Msg {
  id: string
  direction: string
  body: string
  status: string
  created_at: string
}

interface SelectedContact {
  id: string
  name: string
  phone: string
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7)  return `${days}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function InboxClient({
  conversations: initialConvos,
  selectedContactId,
  selectedContact: initialContact,
  thread: initialThread,
}: {
  conversations: Convo[]
  selectedContactId: string | null
  selectedContact: SelectedContact | null
  thread: Msg[]
}) {
  const router = useRouter()
  const supabase = createClient()

  const [convos, setConvos] = useState(initialConvos ?? [])
  const [thread, setThread] = useState((initialThread ?? []).filter(m => m != null))
  const [selectedContact, setSelectedContact] = useState(initialContact)
  const [compose, setCompose] = useState('')
  const [sending, setSending] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [sendError, setSendError] = useState('')
  const [search, setSearch] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom when thread changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread])

  // Supabase realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('inbox_messages')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        const msg = payload.new as (Msg & { contact_id: string }) | null
        if (!msg?.direction) return

        // Update thread if it belongs to the open conversation
        if (selectedContactId && msg.contact_id === selectedContactId) {
          setThread(prev => [...prev, msg])
        }

        // Update convo list
        setConvos(prev => {
          const existing = prev.find(c => c.contactId === msg.contact_id)
          if (existing) {
            return [
              { ...existing, lastMessage: msg.body, lastDirection: msg.direction, lastAt: msg.created_at, unread: msg.direction === 'inbound' },
              ...prev.filter(c => c.contactId !== msg.contact_id),
            ]
          }
          // New contact messaged in — re-fetch to get name
          router.refresh()
          return prev
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [selectedContactId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mobile: track which panel is visible (list vs thread)
  const [mobilePanel, setMobilePanel] = useState<'list' | 'thread'>(
    selectedContactId ? 'thread' : 'list'
  )

  const selectContact = (convo: Convo) => {
    router.push(`/inbox?contact=${convo.contactId}`)
    setSelectedContact({ id: convo.contactId, name: convo.contactName, phone: convo.contactPhone })
    setConvos(prev => prev.map(c => c.contactId === convo.contactId ? { ...c, unread: false } : c))
    setMobilePanel('thread')
  }

  const sendMessage = async () => {
    if (!compose.trim() || !selectedContact || sending) return
    setSending(true)
    setSendError('')
    const body = compose.trim()
    setCompose('')

    // Optimistic
    const tempMsg: Msg = { id: `temp_${Date.now()}`, direction: 'outbound', body, status: 'sending', created_at: new Date().toISOString() }
    setThread(prev => [...prev, tempMsg])

    const res = await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: selectedContact.id, body }),
    })
    const data = await res.json()

    if (!res.ok) {
      // Hard failure (network / auth) — remove optimistic message
      setSendError(data.error ?? 'Failed to send')
      setThread(prev => prev.filter(m => m.id !== tempMsg.id))
      setCompose(body)
    } else {
      // Replace optimistic with real saved message (may have status 'failed' if Twilio rejected)
      if (data.message?.id) {
        setThread(prev => prev.map(m => m.id === tempMsg.id ? data.message : m))
      } else if (data.message) {
        // Message came back but without an id — just remove optimistic
        setThread(prev => prev.filter(m => m.id !== tempMsg.id))
      } else {
        setThread(prev => prev.filter(m => m.id !== tempMsg.id))
      }
      if (data.warning) setSendError(data.warning)
    }
    setSending(false)
  }

  const getSuggestedReply = async () => {
    if (!selectedContact || aiLoading) return
    setAiLoading(true)
    const res = await fetch('/api/sms/ai-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: selectedContact.id }),
    })
    const data = await res.json()
    if (data.suggestion) {
      setCompose(data.suggestion)
      textareaRef.current?.focus()
    }
    setAiLoading(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const safeThread = (thread ?? []).filter((m): m is Msg => m != null)
  const safeConvos = (convos ?? []).filter(c => c != null)

  const filtered = safeConvos.filter(c =>
    (c.contactName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.contactPhone ?? '').includes(search)
  )

  const hasInbound = safeThread.some(m => m.direction === 'inbound')
  const twilioMissing = safeThread.some(m => m.status === 'mock')

  const [inboxTab, setInboxTab] = useState<'sms' | 'email'>('sms')

  return (
    <div style={{ color: 'var(--c-primary)', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', overflow: 'hidden' }} className="md:h-screen md:overflow-hidden">
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)', flexShrink: 0 }}>
        {(['sms', 'email'] as const).map(t => (
          <button key={t} onClick={() => setInboxTab(t)} style={{
            padding: '12px 20px', fontSize: 13, fontWeight: 600,
            color: inboxTab === t ? '#C9A84C' : 'var(--c-text-2)',
            borderBottom: inboxTab === t ? '2px solid #C9A84C' : '2px solid transparent',
            backgroundColor: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            {t === 'sms' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 3H3c-.552 0-1 .448-1 1v14c0 .552.448 1 1 1h5l3 3 3-3h7c.552 0 1-.448 1-1V4c0-.552-.448-1-1-1z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )}
            {t === 'sms' ? 'SMS' : 'Email'}
          </button>
        ))}
      </div>

      {inboxTab === 'email' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <EmailPanel />
        </div>
      ) : (
    <div className="flex flex-1 overflow-hidden" style={{ color: 'var(--c-primary)' }}>

      {/* ── Conversation list — full screen on mobile, 300px panel on desktop ── */}
      <div
        className={`${mobilePanel === 'list' ? 'flex' : 'hidden'} md:flex flex-col`}
        style={{ width: '100%', maxWidth: '100%', borderRight: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}
      >
        {/* On md+, lock to 300px via inline override */}
        <style>{`@media (min-width: 768px) { .inbox-list { width: 300px !important; min-width: 300px !important; max-width: 300px !important; } }`}</style>

        <div className="inbox-list flex flex-col" style={{ width: '100%', height: '100%' }}>
          <div className="px-4 pt-5 pb-3">
            <h1 className="text-xl font-bold mb-3" style={{ color: 'var(--c-primary)' }}>Inbox</h1>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
              </svg>
              <input
                placeholder="Search contacts…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm rounded-xl focus:outline-none"
                style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)', color: 'var(--c-primary)' }}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                  {convos.length === 0 ? 'No conversations yet' : 'No matches'}
                </p>
                {convos.length === 0 && (
                  <p className="text-xs mt-2" style={{ color: 'var(--c-text-3)' }}>
                    Open a contact and send your first message
                  </p>
                )}
              </div>
            )}
            {filtered.map(convo => (
              <button
                key={convo.contactId}
                onClick={() => selectContact(convo)}
                className="w-full text-left px-4 py-3.5 transition-colors active:opacity-70"
                style={{
                  backgroundColor: selectedContactId === convo.contactId ? 'rgba(201,168,76,0.1)' : 'transparent',
                  borderLeft: selectedContactId === convo.contactId ? '3px solid #C9A84C' : '3px solid transparent',
                }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-semibold truncate" style={{ color: 'var(--c-primary)' }}>
                    {convo.contactName}
                  </span>
                  <span className="text-xs flex-shrink-0 ml-2" style={{ color: 'var(--c-text-3)' }}>
                    {timeAgo(convo.lastAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs truncate flex-1" style={{ color: 'var(--c-text-2)' }}>
                    {convo.lastDirection === 'outbound' ? 'You: ' : ''}{convo.lastMessage}
                  </p>
                  {convo.unread && (
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#C9A84C' }} />
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="p-3" style={{ borderTop: '1px solid var(--c-border)' }}>
            <a href="/contacts"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-semibold"
              style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Open a Contact to Message
            </a>
          </div>
        </div>
      </div>

      {/* ── Thread — full screen on mobile, flex-1 on desktop ── */}
      <div
        className={`${mobilePanel === 'thread' ? 'flex' : 'hidden'} md:flex flex-col flex-1 overflow-hidden`}
      >
        {!selectedContact ? (
          <div className="flex-1 flex items-center justify-center flex-col gap-3">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--c-card-alt)' }}>
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-text-3)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 3H3c-.552 0-1 .448-1 1v14c0 .552.448 1 1 1h5l3 3 3-3h7c.552 0 1-.448 1-1V4c0-.552-.448-1-1-1z" />
              </svg>
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>Select a conversation</p>
            <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>or open a contact to start one</p>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
              {/* Back button — mobile only */}
              <button
                className="md:hidden flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full"
                style={{ backgroundColor: 'var(--c-card-alt)' }}
                onClick={() => setMobilePanel('list')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--c-primary)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                <a href={`/contacts/${selectedContact?.id}`}
                  className="text-base font-bold hover:underline truncate block" style={{ color: 'var(--c-primary)' }}>
                  {selectedContact?.name}
                </a>
                <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>{selectedContact?.phone}</p>
              </div>
              <a href={`/contacts/${selectedContact?.id}`}
                className="hidden md:block text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0"
                style={{ backgroundColor: 'var(--c-card-alt)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                View Contact →
              </a>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
              {thread.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No messages yet — send the first one below</p>
                </div>
              )}
              {safeThread.map(msg => (
                <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[78%] px-4 py-2.5 rounded-2xl text-sm"
                    style={msg.direction === 'outbound'
                      ? { backgroundColor: '#0A1F44', color: '#fff', borderBottomRightRadius: 4 }
                      : { backgroundColor: 'var(--c-card-alt)', color: 'var(--c-primary)', border: '1px solid var(--c-border)', borderBottomLeftRadius: 4 }
                    }
                  >
                    <p className="leading-relaxed">{msg.body}</p>
                    <p className="text-xs mt-1 opacity-50">
                      {msg.status === 'sending' ? 'Sending…'
                        : msg.status === 'failed' ? 'Not delivered'
                        : timeAgo(msg.created_at)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Compose */}
            <div className="px-4 pb-4 pt-3" style={{ borderTop: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
              {sendError && <p className="text-xs text-red-500 mb-2">{sendError}</p>}
              {hasInbound && (
                <div className="mb-2">
                  <button
                    onClick={getSuggestedReply}
                    disabled={aiLoading}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                    style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}
                  >
                    {aiLoading
                      ? <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Generating…</>
                      : 'AI Suggest Reply'
                    }
                  </button>
                </div>
              )}
              <div className="flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  value={compose}
                  onChange={e => setCompose(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message…"
                  rows={2}
                  className="flex-1 resize-none rounded-2xl px-4 py-3 text-sm focus:outline-none"
                  style={{ backgroundColor: 'var(--c-card-alt)', border: '1px solid var(--c-border)', color: 'var(--c-primary)', maxHeight: 120 }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!compose.trim() || sending}
                  className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40"
                  style={{ backgroundColor: '#0A1F44' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#C9A84C' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
      )}
    </div>
  )
}

