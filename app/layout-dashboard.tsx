'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { isOwner } from '@/lib/roles'

const GlobalSearch = dynamic(() => import('@/components/GlobalSearch'), { ssr: false })

// ── Icons ─────────────────────────────────────────────────────────────────────

const Ic = {
  dashboard: <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  leads:     <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
  contacts:  <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  deals:     <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>,
  pipeline:  <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>,
  search:    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>,
  d4d:       <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  scraper:   <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>,
  inbox:     <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
  documents: <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  settings:  <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  reports:   <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  admin:     <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
  user:      <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
  signout:   <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>,
  chevron:   <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>,
  bell:      <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>,
  company:   <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  users:     <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  key:       <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>,
  puzzle:    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" /></svg>,
  help:      <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
}

// ── Nav structure ─────────────────────────────────────────────────────────────

interface NavItem  { label: string; href: string; icon: React.ReactNode }
interface NavGroup { key: string; label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'crm',
    label: 'CRM',
    items: [
      { label: 'Leads',     href: '/leads',    icon: Ic.leads    },
      { label: 'Contacts',  href: '/contacts', icon: Ic.contacts },
      { label: 'Deals',     href: '/deals',    icon: Ic.deals    },
      { label: 'Pipeline',  href: '/pipeline', icon: Ic.pipeline },
    ],
  },
  {
    key: 'property',
    label: 'Property Intelligence',
    items: [
      { label: 'Property Search', href: '/property-search', icon: Ic.search  },
      { label: 'Driving for Dollars', href: '/d4d',         icon: Ic.d4d     },
      { label: 'Scraper',         href: '/scraper',         icon: Ic.scraper },
    ],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    items: [
      { label: 'Reports', href: '/reports', icon: Ic.reports },
    ],
  },
  {
    key: 'comms',
    label: 'Communications',
    items: [
      { label: 'Inbox', href: '/inbox', icon: Ic.inbox },
    ],
  },
  {
    key: 'docs',
    label: 'Documents',
    items: [
      { label: 'Documents',   href: '/documents',             icon: Ic.documents },
      { label: 'Templates',   href: '/documents/templates',   icon: <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg> },
      { label: 'Signatures',  href: '/sign-sessions',         icon: <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg> },
    ],
  },
]

const BOTTOM_NAV_HREFS = ['/', '/leads', '/contacts', '/inbox', '/pipeline']

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  // Auth / role state
  const [ownerAccess,       setOwnerAccess]       = useState(false)
  const [adminToolsEnabled, setAdminToolsEnabled] = useState(false)
  const [displayName,       setDisplayName]       = useState('')
  const [userRole,          setUserRole]          = useState('')
  const [userInitials,      setUserInitials]      = useState('CG')

  // Sidebar collapse (full sidebar)
  const [collapsed,    setCollapsed]    = useState(false)
  const [sidebarReady, setSidebarReady] = useState(false)

  // Category expand/collapse (keyed by group.key)
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({})

  // Profile menu open/close
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  // Global search
  const [searchOpen, setSearchOpen] = useState(false)

  // Pinned nav items
  const [pinned, setPinned] = useState<string[]>([])
  const [hoveredHref, setHoveredHref] = useState<string | null>(null)

  // Mobile
  const [showMore,     setShowMore]     = useState(false)
  const [showMobileProfile, setShowMobileProfile] = useState(false)

  // ── Persistence ──────────────────────────────────────────────────────────────

  useEffect(() => {
    // Sidebar collapsed state
    const savedCollapsed = localStorage.getItem('nk_sidebar_collapsed')
    if (savedCollapsed !== null) setCollapsed(savedCollapsed === 'true')

    // Per-group open state — default all open
    const savedGroups = localStorage.getItem('nk_group_open')
    if (savedGroups) {
      try { setGroupOpen(JSON.parse(savedGroups)) } catch { /* ignore */ }
    } else {
      const defaults: Record<string, boolean> = {}
      NAV_GROUPS.forEach(g => { defaults[g.key] = true })
      setGroupOpen(defaults)
    }

    // Pinned items
    const savedPinned = localStorage.getItem('nk_pinned')
    if (savedPinned) {
      try { setPinned(JSON.parse(savedPinned)) } catch { /* ignore */ }
    }

    setSidebarReady(true)
  }, [])

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(v => !v)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const togglePin = (href: string) => {
    setPinned(prev => {
      const next = prev.includes(href) ? prev.filter(h => h !== href) : [...prev, href]
      localStorage.setItem('nk_pinned', JSON.stringify(next))
      return next
    })
  }

  const toggleSidebar = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('nk_sidebar_collapsed', String(next))
      return next
    })
  }

  const toggleGroup = (key: string) => {
    setGroupOpen(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem('nk_group_open', JSON.stringify(next))
      return next
    })
  }

  // ── User / auth ──────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const email = data.user?.email ?? ''
      const owner = isOwner(email)
      setOwnerAccess(owner)

      try {
        // Primary: use profile display_name + my_name
        const [profileRes, sigRes] = await Promise.all([
          fetch('/api/user/profile'),
          fetch('/api/user/signature'),
        ])
        const profile = profileRes.ok ? await profileRes.json() : {}
        const sig     = sigRes.ok     ? await sigRes.json()     : {}

        const name = profile.display_name || sig.my_name || email.split('@')[0].replace(/[^a-z]/gi, ' ').trim()
        setDisplayName(name)

        const parts = name.trim().split(/\s+/).filter(Boolean)
        setUserInitials(parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : name.slice(0, 2).toUpperCase())

        const role = profile.role ?? 'user'
        setUserRole(role.charAt(0).toUpperCase() + role.slice(1))

        const isAdminRole = role === 'owner' || role === 'admin'
        setAdminToolsEnabled(owner || (isAdminRole && profile.show_admin_tools))
      } catch {
        if (owner) setAdminToolsEnabled(true)
        setDisplayName(email.split('@')[0])
        setUserInitials('CG')
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close profile menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    if (href === '/property-search') return pathname.startsWith('/property-search')
    if (href === '/leads') return pathname.startsWith('/leads')
    return pathname.startsWith(href.split('?')[0])
  }

  const anyGroupItemActive = (group: NavGroup) => group.items.some(i => isActive(i.href))

  const sideW = collapsed ? '64px' : '220px'

  // ── Shared nav item renderer ─────────────────────────────────────────────────

  const NavLink = ({ item, compact = false, showPin = false }: { item: NavItem; compact?: boolean; showPin?: boolean }) => {
    const active   = isActive(item.href)
    const isPinned = pinned.includes(item.href)
    const hovered  = hoveredHref === item.href

    return (
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setHoveredHref(item.href)}
        onMouseLeave={() => setHoveredHref(null)}
      >
        <a
          href={item.href}
          title={compact ? item.label : undefined}
          className={`flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-colors
            ${active ? '' : 'text-white/50 hover:text-white hover:bg-white/[0.06]'}
            ${compact ? 'justify-center px-0 py-2' : 'px-2.5 py-2'}`}
          style={{
            ...(active ? { backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' } : {}),
            paddingRight: showPin && !compact ? 28 : undefined,
          }}
        >
          {item.icon}
          {!compact && <span className="truncate">{item.label}</span>}
        </a>
        {/* Pin button — shown on hover (not in compact mode) */}
        {showPin && !compact && hovered && (
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); togglePin(item.href) }}
            title={isPinned ? 'Unpin' : 'Pin to top'}
            style={{
              position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: isPinned ? '#C9A84C' : 'rgba(255,255,255,0.2)',
              padding: '2px', lineHeight: 1, display: 'flex', alignItems: 'center',
              transition: 'color 0.1s',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  // ── Profile menu ─────────────────────────────────────────────────────────────

  const ProfileMenuContent = ({ onAction }: { onAction: () => void }) => (
    <div style={{
      backgroundColor: '#0d2550',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 12,
      minWidth: 220,
      overflow: 'hidden',
      boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
    }}>
      {/* Identity */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ color: '#fff', fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{displayName || 'User'}</p>
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{userRole || 'Member'}</p>
      </div>

      {/* Personal */}
      <div style={{ padding: '6px 8px' }}>
        {[
          { label: 'My Profile',    href: '/profile',        icon: Ic.user     },
          { label: 'Notifications', href: '/notifications',  icon: Ic.bell     },
          { label: 'Preferences',   href: '/preferences',    icon: Ic.settings },
        ].map(item => (
          <a key={item.label} href={item.href} onClick={onAction}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-white/60 hover:text-white hover:bg-white/[0.07] transition-colors">
            {item.icon}
            {item.label}
          </a>
        ))}
      </div>

      {/* Admin section — role-gated */}
      {adminToolsEnabled && (
        <>
          <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />
          <div style={{ padding: '6px 8px' }}>
            {([
              { label: 'Company Settings', href: '/company-settings', icon: Ic.company, show: true        },
              { label: 'Integrations',     href: '/integrations',     icon: Ic.puzzle,  show: true        },
              { label: 'API Keys',         href: '/api-keys',         icon: Ic.key,     show: ownerAccess },
              { label: 'Admin Console',    href: '/admin',            icon: Ic.admin,   show: true        },
            ] as { label: string; href: string; icon: React.ReactNode; show: boolean }[])
              .filter(item => item.show)
              .map(item => (
                <a key={item.label} href={item.href} onClick={onAction}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-white/60 hover:text-white hover:bg-white/[0.07] transition-colors">
                  {item.icon}
                  {item.label}
                </a>
              ))}
          </div>
        </>
      )}

      {/* Bottom */}
      <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />
      <div style={{ padding: '6px 8px' }}>
        <a href="/help" onClick={onAction}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-white/60 hover:text-white hover:bg-white/[0.07] transition-colors">
          {Ic.help}
          Help Center
        </a>
        <button onClick={() => { onAction(); handleSignOut() }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-white/60 hover:text-white hover:bg-white/[0.07] transition-colors text-left">
          {Ic.signout}
          Sign Out
        </button>
      </div>
    </div>
  )

  // ── Build mobile-nav items ────────────────────────────────────────────────────

  const allItems: NavItem[] = [
    { label: 'Dashboard', href: '/', icon: Ic.dashboard },
    ...NAV_GROUPS.flatMap(g => g.items),
  ]
  const visibleBottom = allItems.filter(i => BOTTOM_NAV_HREFS.includes(i.href))
  const moreItems     = allItems.filter(i => !BOTTOM_NAV_HREFS.includes(i.href))

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">

      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col h-full border-r border-white/10 transition-all duration-200"
        style={{
          backgroundColor: '#0A1F44',
          width:    sidebarReady ? sideW : '220px',
          minWidth: sidebarReady ? sideW : '220px',
          overflow: 'hidden',
        }}
      >
        {/* Logo + collapse toggle */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-white/10 shrink-0">
          {!collapsed && (
            <a href="/" className="flex items-center gap-2 min-w-0 no-underline">
              <span style={{ color: '#C9A84C' }} className="text-lg font-bold tracking-tight whitespace-nowrap">NextKey</span>
              <span style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0">OS</span>
            </a>
          )}
          <button
            onClick={toggleSidebar}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10 transition-colors shrink-0"
            style={{
              color: 'rgba(255,255,255,0.35)',
              marginLeft: collapsed ? 'auto' : undefined,
              marginRight: collapsed ? 'auto' : undefined,
            }}
          >
            {collapsed ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
              </svg>
            )}
          </button>
        </div>

        {/* Search bar */}
        <div style={{ padding: '8px 10px 4px', flexShrink: 0 }}>
          <button
            onClick={() => setSearchOpen(true)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: collapsed ? '8px 0' : '7px 10px',
              borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
              backgroundColor: 'rgba(255,255,255,0.04)',
              cursor: 'pointer', transition: 'background 0.15s',
              justifyContent: collapsed ? 'center' : 'flex-start',
            }}
            title={collapsed ? 'Search (⌘K)' : undefined}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)')}
          >
            <svg style={{ width: 14, height: 14, flexShrink: 0, color: 'rgba(255,255,255,0.3)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {!collapsed && (
              <>
                <span style={{ flex: 1, textAlign: 'left', fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>Search…</span>
                <kbd style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px', fontFamily: 'inherit', flexShrink: 0 }}>⌘K</kbd>
              </>
            )}
          </button>
        </div>

        {/* Scrollable nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 space-y-0.5">

          {/* Pinned section */}
          {!collapsed && pinned.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(201,168,76,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px 2px' }}>
                Pinned
              </div>
              <div className="space-y-0.5">
                {pinned.map(href => {
                  const item = [...allItems].find(i => i.href === href)
                  return item ? <NavLink key={href} item={item} showPin /> : null
                })}
              </div>
              <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', margin: '6px 2px' }} />
            </div>
          )}

          {/* Dashboard — always visible */}
          <NavLink item={{ label: 'Dashboard', href: '/', icon: Ic.dashboard }} compact={collapsed} showPin={!pinned.includes('/')} />

          {/* Category groups */}
          {NAV_GROUPS.map(group => {
            const open    = groupOpen[group.key] !== false
            const hasActive = anyGroupItemActive(group)

            if (collapsed) {
              return (
                <div key={group.key} className="mt-1">
                  {group.items.map(item => (
                    <NavLink key={item.href} item={item} compact />
                  ))}
                </div>
              )
            }

            return (
              <div key={group.key} className="mt-2">
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="w-full flex items-center justify-between px-2 py-1 rounded-lg hover:bg-white/[0.04] transition-colors group"
                >
                  <span style={{ color: hasActive ? 'rgba(201,168,76,0.7)' : 'rgba(255,255,255,0.25)' }}
                    className="text-[10px] font-bold tracking-[0.08em] uppercase">
                    {group.label}
                  </span>
                  <span style={{
                    color: 'rgba(255,255,255,0.2)',
                    transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.15s',
                    display: 'flex',
                  }}>
                    {Ic.chevron}
                  </span>
                </button>

                {open && (
                  <div className="mt-0.5 space-y-0.5">
                    {group.items.map(item => (
                      <NavLink key={item.href} item={item} showPin />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* User profile area */}
        <div
          ref={profileRef}
          className="shrink-0 border-t border-white/10 px-2 py-3 relative"
        >
          {collapsed ? (
            /* Collapsed: avatar only, click opens menu above */
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setProfileOpen(v => !v)}
                title={displayName}
                className="flex items-center justify-center w-full py-1 hover:opacity-80"
              >
                <div style={{ backgroundColor: 'rgba(201,168,76,0.2)' }}
                  className="w-8 h-8 rounded-full flex items-center justify-center">
                  <span style={{ color: '#C9A84C' }} className="text-xs font-bold">{userInitials}</span>
                </div>
              </button>
              {profileOpen && (
                <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8, zIndex: 100 }}>
                  <ProfileMenuContent onAction={() => setProfileOpen(false)} />
                </div>
              )}
            </div>
          ) : (
            /* Expanded: name + role row, click opens menu */
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setProfileOpen(v => !v)}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.06] transition-colors text-left"
              >
                <div style={{ backgroundColor: 'rgba(201,168,76,0.2)' }}
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                  <span style={{ color: '#C9A84C' }} className="text-xs font-bold">{userInitials}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p style={{ color: '#fff' }} className="text-[13px] font-semibold truncate leading-tight">{displayName || 'User'}</p>
                  <p style={{ color: 'rgba(255,255,255,0.35)' }} className="text-[11px] truncate">{userRole || 'Member'}</p>
                </div>
                <span style={{ color: 'rgba(255,255,255,0.2)', transform: profileOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', display: 'flex' }}>
                  {Ic.chevron}
                </span>
              </button>

              {profileOpen && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 8, zIndex: 100 }}>
                  <ProfileMenuContent onAction={() => setProfileOpen(false)} />
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── Mobile top bar ───────────────────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 flex items-center justify-between px-4 h-12"
        style={{ backgroundColor: '#0A1F44', borderBottom: '1px solid rgba(255,255,255,0.1)', zIndex: 9999 }}>
        <div className="flex items-center gap-2">
          <span style={{ color: '#C9A84C' }} className="text-base font-bold tracking-tight">NextKey</span>
          <span style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}
            className="text-xs font-bold px-1.5 py-0.5 rounded">OS</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Mobile search button */}
          <button onClick={() => setSearchOpen(true)}
            style={{ color: 'rgba(255,255,255,0.45)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <button
            onClick={() => setShowMobileProfile(v => !v)}
            style={{ backgroundColor: 'rgba(201,168,76,0.2)' }}
            className="w-8 h-8 rounded-full flex items-center justify-center">
            <span style={{ color: '#C9A84C' }} className="text-xs font-bold">{userInitials}</span>
          </button>
        </div>
        {showMobileProfile && (
          <div style={{ position: 'absolute', top: '100%', right: 12, marginTop: 4, zIndex: 10001 }}>
            <ProfileMenuContent onAction={() => setShowMobileProfile(false)} />
          </div>
        )}
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main
        className="flex-1 overflow-auto pt-12 md:pt-0 pb-20 md:pb-0 min-w-0"
        style={{ color: 'var(--c-primary)', position: 'relative', zIndex: 0 }}
        onClick={() => { setShowMobileProfile(false); setShowMore(false); setProfileOpen(false) }}
      >
        {children}
      </main>

      {/* ── Global Search ────────────────────────────────────────────────── */}
      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}

      {/* ── Mobile overlay + bottom nav ──────────────────────────────────── */}
      <div className="md:hidden">

        {showMore && (
          <div className="fixed inset-0 bg-black/50" style={{ zIndex: 9990 }}
            onClick={() => setShowMore(false)} />
        )}

        {/* More sheet — grouped */}
        <div
          className={`fixed left-0 right-0 transition-transform duration-300 ease-out ${showMore ? 'translate-y-0' : 'translate-y-full'}`}
          style={{ bottom: 60, zIndex: 9995, backgroundColor: '#0A1F44', borderTop: '1px solid rgba(255,255,255,0.15)', borderRadius: '20px 20px 0 0', maxHeight: '70vh', overflowY: 'auto' }}
        >
          <div className="px-4 pt-4 pb-6">
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }} />
            {NAV_GROUPS.map(group => {
              const hasMore = group.items.some(i => !BOTTOM_NAV_HREFS.includes(i.href))
              if (!hasMore) return null
              return (
                <div key={group.key} className="mb-4">
                  <p className="text-[10px] font-bold tracking-widest mb-2 px-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {group.label.toUpperCase()}
                  </p>
                  {group.items.filter(i => !BOTTOM_NAV_HREFS.includes(i.href)).map(item => (
                    <a key={item.href} href={item.href} onClick={() => setShowMore(false)}
                      className="flex items-center gap-3 px-4 py-3.5 rounded-2xl mb-1 active:opacity-70"
                      style={{
                        backgroundColor: isActive(item.href) ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.05)',
                        color: isActive(item.href) ? '#C9A84C' : 'rgba(255,255,255,0.8)',
                      }}
                    >
                      {item.icon}
                      <span className="text-sm font-semibold">{item.label}</span>
                      {isActive(item.href) && <span className="ml-auto w-2 h-2 rounded-full" style={{ backgroundColor: '#C9A84C' }} />}
                    </a>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* Bottom nav */}
        <nav className="fixed bottom-0 left-0 right-0 flex items-center justify-around"
          style={{ backgroundColor: '#0A1F44', borderTop: '1px solid rgba(255,255,255,0.12)', height: 60, zIndex: 9999, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {visibleBottom.map(item => (
            <a key={item.href} href={item.href}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full active:opacity-60"
              style={{ color: isActive(item.href) ? '#C9A84C' : 'rgba(255,255,255,0.4)' }}>
              {item.icon}
              <span className="text-[10px] font-semibold">{item.label}</span>
            </a>
          ))}
          {moreItems.length > 0 && (
            <button type="button"
              onClick={e => { e.stopPropagation(); setShowMore(v => !v) }}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full active:opacity-60"
              style={{ color: showMore || moreItems.some(i => isActive(i.href)) ? '#C9A84C' : 'rgba(255,255,255,0.4)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
              </svg>
              <span className="text-[10px] font-semibold">More</span>
            </button>
          )}
        </nav>
      </div>
    </div>
  )
}
