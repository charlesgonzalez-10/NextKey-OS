'use client'

import { useState, useEffect, useCallback } from 'react'

type Category = 'all' | 'communications' | 'tasks' | 'deals' | 'system'

interface Notification {
  id: string
  category: Category
  title: string
  body: string
  time: string
  read: boolean
  href?: string
  icon: string
  color: string
}

const STORAGE_KEY = 'nk_notif_read'

function loadRead(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')) } catch { return new Set() }
}

function saveRead(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
}

const CATEGORY_TABS: { key: Category; label: string }[] = [
  { key: 'all',            label: 'All'            },
  { key: 'communications', label: 'Communications'  },
  { key: 'tasks',          label: 'Tasks'           },
  { key: 'deals',          label: 'Deals'           },
  { key: 'system',         label: 'System'          },
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationsClient() {
  const [items,    setItems]    = useState<Notification[]>([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState<Category>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)

  const buildNotifications = useCallback(async (): Promise<Notification[]> => {
    const read = loadRead()
    const notifs: Notification[] = []

    // Gmail status
    try {
      const gmail = await fetch('/api/auth/gmail/status').then(r => r.json())
      if (!gmail.connected) {
        notifs.push({ id: 'sys-gmail', category: 'system', icon: '✉️', color: '#ef4444',
          title: 'Gmail Disconnected', body: 'Reconnect Gmail to send and receive emails inside NextKey OS.',
          time: new Date().toISOString(), href: '/integrations', read: read.has('sys-gmail') })
      }
    } catch { /* skip */ }

    // Tasks due today / overdue
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await fetch(`/api/contacts?limit=1`) // check if API is accessible
      if (res.ok) {
        // Fetch tasks via contacts tasks endpoint isn't ideal — scaffold structure for now
        notifs.push({ id: 'tasks-placeholder', category: 'tasks', icon: '📋', color: '#C9A84C',
          title: 'Check your follow-up queue', body: 'Review contacts with follow-up dates set to today or earlier.',
          time: new Date(Date.now() - 2 * 60000).toISOString(), href: '/contacts?view=preset-due-today',
          read: read.has('tasks-placeholder') })
      }
    } catch { /* skip */ }

    // Recent activity from dashboard summary
    try {
      const summary = await fetch('/api/dashboard/summary').then(r => r.json())
      if (summary?.pipeline_value > 0) {
        notifs.push({ id: 'deals-pipeline', category: 'deals', icon: '🤝', color: '#818cf8',
          title: 'Pipeline Update', body: `You have $${Number(summary.pipeline_value).toLocaleString()} in active pipeline across ${summary.active_deals ?? 0} deals.`,
          time: new Date(Date.now() - 10 * 60000).toISOString(), href: '/pipeline',
          read: read.has('deals-pipeline') })
      }
      if (summary?.leads_this_month > 0) {
        notifs.push({ id: 'leads-month', category: 'deals', icon: '📋', color: '#C9A84C',
          title: 'New Leads This Month', body: `${summary.leads_this_month} new leads have been added this month.`,
          time: new Date(Date.now() - 30 * 60000).toISOString(), href: '/leads',
          read: read.has('leads-month') })
      }
    } catch { /* skip */ }

    // Sort by time desc
    notifs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())

    // If nothing real, show a welcome notification
    if (notifs.length === 0) {
      notifs.push({ id: 'welcome', category: 'system', icon: '🎉', color: '#4ACF9A',
        title: 'Welcome to NextKey OS', body: 'Your notification center is active. Activity from deals, tasks, contacts, and integrations will appear here.',
        time: new Date().toISOString(), read: read.has('welcome') })
    }

    return notifs.map(n => ({ ...n, read: read.has(n.id) }))
  }, [])

  useEffect(() => {
    buildNotifications().then(n => { setItems(n); setLoading(false) })
  }, [buildNotifications])

  const markRead = (id: string) => {
    const read = loadRead()
    read.add(id)
    saveRead(read)
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  const markAllRead = () => {
    const read = loadRead()
    items.forEach(n => read.add(n.id))
    saveRead(read)
    setItems(prev => prev.map(n => ({ ...n, read: true })))
  }

  const filtered = items.filter(n => {
    if (filter !== 'all' && n.category !== filter) return false
    if (unreadOnly && n.read) return false
    return true
  })

  const unreadCount = items.filter(n => !n.read).length

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', color: 'var(--c-primary)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Notifications</h1>
          <p style={{ fontSize: 14, color: 'var(--c-text-2)' }}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-2)', backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>
            Mark all read
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {CATEGORY_TABS.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
            backgroundColor: filter === t.key ? '#0A1F44' : 'var(--c-hover)',
            color: filter === t.key ? '#C9A84C' : 'var(--c-text-2)',
          }}>{t.label}</button>
        ))}
        <button onClick={() => setUnreadOnly(v => !v)} style={{
          marginLeft: 'auto', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          border: `1px solid ${unreadOnly ? '#C9A84C' : 'var(--c-border)'}`,
          backgroundColor: unreadOnly ? 'rgba(201,168,76,0.1)' : 'transparent',
          color: unreadOnly ? '#C9A84C' : 'var(--c-text-2)',
        }}>Unread only</button>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--c-text-2)', fontSize: 14 }}>Loading notifications…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '64px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔔</div>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Nothing here</p>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>No notifications in this category.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {filtered.map(n => (
            <div key={n.id}
              onClick={() => { markRead(n.id); if (n.href) window.location.href = n.href }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '14px 16px', borderRadius: 12, cursor: n.href ? 'pointer' : 'default',
                backgroundColor: n.read ? 'var(--c-card)' : 'rgba(201,168,76,0.06)',
                border: `1px solid ${n.read ? 'var(--c-border)' : 'rgba(201,168,76,0.2)'}`,
                marginBottom: 6,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (n.href) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--c-hover)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = n.read ? 'var(--c-card)' : 'rgba(201,168,76,0.06)' }}
            >
              {/* Icon */}
              <div style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: `${n.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>
                {n.icon}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                  <p style={{ fontSize: 14, fontWeight: n.read ? 500 : 700, color: 'var(--c-primary)' }}>{n.title}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#C9A84C', display: 'inline-block' }} />}
                    <span style={{ fontSize: 12, color: 'var(--c-text-2)', whiteSpace: 'nowrap' }}>{timeAgo(n.time)}</span>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: 'var(--c-text-2)', lineHeight: 1.5 }}>{n.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginTop: 20, textAlign: 'center' }}>
        Real-time push notifications coming in a future update.
      </p>
    </div>
  )
}
