'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isOwner } from '@/lib/roles'

const navItems = [
  {
    label: 'Dashboard',
    href: '/',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    label: 'Contacts',
    href: '/contacts',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    label: 'Inbox',
    href: '/inbox',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 3H3c-.552 0-1 .448-1 1v14c0 .552.448 1 1 1h5l3 3 3-3h7c.552 0 1-.448 1-1V4c0-.552-.448-1-1-1z" />
      </svg>
    ),
  },
  {
    label: 'Deals',
    href: '/deals',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    label: 'Pipeline',
    href: '/pipeline',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    ),
  },
  {
    label: 'Property Search',
    href: '/leads',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
      </svg>
    ),
  },
  {
    label: 'Leads',
    href: '/leads?is_lead=true',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    label: 'Scraper',
    href: '/scraper',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    ),
  },
]

// Bottom nav primary items — everything else goes in the "More" sheet
const bottomNavItems = ['/', '/contacts', '/inbox', '/deals', '/pipeline']

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  const [ownerAccess, setOwnerAccess]   = useState(false)
  const [userInitials, setUserInitials] = useState('CG')
  const [showSignOut, setShowSignOut]   = useState(false)
  const [showMore, setShowMore]         = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? ''
      setOwnerAccess(isOwner(email))
      // derive initials from email name part
      const name = email.split('@')[0].replace(/[^a-z]/gi, ' ').trim()
      const parts = name.split(' ').filter(Boolean)
      setUserInitials(parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase())
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'

    // Split href into path + optional query string
    const [hrefPath, hrefQuery] = href.split('?')
    if (!pathname.startsWith(hrefPath)) return false

    // Read current query string from the browser (safe — always client-side)
    const currentSearch = typeof window !== 'undefined' ? window.location.search : ''
    const currentParams = new URLSearchParams(currentSearch)

    if (hrefQuery) {
      // href has required query params — only active when current URL also has them
      const hrefParams = new URLSearchParams(hrefQuery)
      for (const [key, value] of hrefParams.entries()) {
        if (currentParams.get(key) !== value) return false
      }
      return true
    } else {
      // href has no query — not active when a more-specific sibling nav item's
      // query params are present (e.g. /leads is inactive when ?is_lead=true)
      if (hrefPath === '/leads' && currentParams.get('is_lead') === 'true') return false
      return true
    }
  }

  const visibleNav   = navItems.filter(item => item.href !== '/scraper' || ownerAccess)
  const visibleBottom = visibleNav.filter(item => bottomNavItems.includes(item.href))
  const moreItems     = visibleNav.filter(item => !bottomNavItems.includes(item.href))

  return (
    <div className="flex h-full">

      {/* ── Desktop sidebar (hidden on mobile) ── */}
      <aside
        style={{ backgroundColor: '#0A1F44', width: '240px', minWidth: '240px' }}
        className="hidden md:flex flex-col h-full border-r border-white/10"
      >
        {/* Logo */}
        <div style={{ borderColor: 'rgba(255,255,255,0.1)' }} className="px-6 py-5 border-b">
          <div className="flex items-center gap-2">
            <span style={{ color: '#C9A84C' }} className="text-xl font-bold tracking-tight">NextKey</span>
            <span style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}
              className="text-xs font-bold px-1.5 py-0.5 rounded">
              OS
            </span>
          </div>
          <p className="text-white/30 text-xs mt-0.5">Property Solutions</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNav.map(item => (
            <a
              key={item.href}
              href={item.href}
              style={isActive(item.href) ? { backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' } : {}}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive(item.href) ? '' : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {item.icon}
              {item.label}
            </a>
          ))}
        </nav>

        {/* User */}
        <div style={{ borderColor: 'rgba(255,255,255,0.1)' }} className="px-4 py-4 border-t">
          <div className="flex items-center gap-3 mb-3">
            <div style={{ backgroundColor: 'rgba(201,168,76,0.2)' }}
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
              <span style={{ color: '#C9A84C' }} className="text-xs font-bold">{userInitials}</span>
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-semibold truncate">NextKey OS</p>
              <p className="text-white/30 text-xs truncate">Property Solutions</p>
            </div>
          </div>
          <button onClick={handleSignOut}
            className="w-full text-left text-white/30 hover:text-white/60 text-xs transition-colors px-1">
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile top bar (hidden on desktop) ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 flex items-center justify-between px-4 h-12"
        style={{ backgroundColor: '#0A1F44', borderBottom: '1px solid rgba(255,255,255,0.1)', zIndex: 9999 }}>
        <div className="flex items-center gap-2">
          <span style={{ color: '#C9A84C' }} className="text-base font-bold tracking-tight">NextKey</span>
          <span style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}
            className="text-xs font-bold px-1.5 py-0.5 rounded">
            OS
          </span>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowSignOut(v => !v)}
            style={{ backgroundColor: 'rgba(201,168,76,0.2)' }}
            className="w-8 h-8 rounded-full flex items-center justify-center">
            <span style={{ color: '#C9A84C' }} className="text-xs font-bold">{userInitials}</span>
          </button>
          {showSignOut && (
            <div className="absolute right-0 top-10 rounded-xl shadow-lg py-1 z-50 min-w-[120px]"
              style={{ backgroundColor: '#0A1F44', border: '1px solid rgba(255,255,255,0.15)' }}>
              <button
                onClick={handleSignOut}
                className="w-full text-left px-4 py-2.5 text-sm text-white/60 hover:text-white"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <main
        className="flex-1 overflow-auto pt-12 md:pt-0 pb-20 md:pb-0"
        style={{ color: 'var(--c-primary)', position: 'relative', zIndex: 0 }}
        onClick={() => { setShowSignOut(false); setShowMore(false) }}
      >
        {children}
      </main>

      {/* ── Mobile-only overlays & bottom nav ── */}
      <div className="md:hidden">

        {/* Backdrop */}
        {showMore && (
          <div
            className="fixed inset-0 bg-black/50"
            style={{ zIndex: 9990 }}
            onClick={() => setShowMore(false)}
          />
        )}

        {/* More sheet */}
        <div
          className={`fixed left-0 right-0 transition-transform duration-300 ease-out ${showMore ? 'translate-y-0' : 'translate-y-full'}`}
          style={{
            bottom: 60,
            zIndex: 9995,
            backgroundColor: '#0A1F44',
            borderTop: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '20px 20px 0 0',
          }}
        >
          <div className="px-4 pt-4 pb-4">
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <p className="text-xs font-bold tracking-widest mb-3 px-1" style={{ color: 'rgba(255,255,255,0.3)' }}>MORE PAGES</p>
            {moreItems.map(item => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 px-4 py-4 rounded-2xl mb-1 active:opacity-70"
                style={{
                  backgroundColor: isActive(item.href) ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.05)',
                  color: isActive(item.href) ? '#C9A84C' : 'rgba(255,255,255,0.8)',
                }}
              >
                {item.icon}
                <span className="text-base font-semibold">{item.label}</span>
                {isActive(item.href) && (
                  <span className="ml-auto w-2 h-2 rounded-full" style={{ backgroundColor: '#C9A84C' }} />
                )}
              </a>
            ))}
          </div>
        </div>

        {/* Bottom nav */}
        <nav
          className="fixed bottom-0 left-0 right-0 flex items-center justify-around"
          style={{
            backgroundColor: '#0A1F44',
            borderTop: '1px solid rgba(255,255,255,0.12)',
            height: 60,
            zIndex: 9999,
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {visibleBottom.map(item => (
            <a
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full active:opacity-60"
              style={{ color: isActive(item.href) ? '#C9A84C' : 'rgba(255,255,255,0.4)' }}
            >
              {item.icon}
              <span className="text-[10px] font-semibold">{item.label}</span>
            </a>
          ))}

          {moreItems.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowMore(v => !v) }}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full active:opacity-60"
              style={{ color: showMore || moreItems.some(i => isActive(i.href)) ? '#C9A84C' : 'rgba(255,255,255,0.4)' }}
            >
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
