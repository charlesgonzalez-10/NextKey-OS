'use client'

import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
    label: 'Scraper',
    href: '/scraper',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    ),
  },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside style={{ backgroundColor: '#0A1F44', width: '240px', minWidth: '240px' }}
        className="flex flex-col h-full border-r border-white/10">
        {/* Logo */}
        <div style={{ borderColor: 'rgba(255,255,255,0.1)' }} className="px-6 py-5 border-b">
          <div className="flex items-center gap-2">
            <span style={{ color: '#C9A84C' }} className="text-xl font-bold tracking-tight">NextKey</span>
            <span
              style={{ backgroundColor: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}
              className="text-xs font-bold px-1.5 py-0.5 rounded"
            >
              OS
            </span>
          </div>
          <p className="text-white/30 text-xs mt-0.5">Property Solutions</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              style={isActive(item.href) ? { backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' } : {}}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? ''
                  : 'text-white/50 hover:text-white hover:bg-white/5'
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
              <span style={{ color: '#C9A84C' }} className="text-xs font-bold">CG</span>
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-semibold truncate">Charles Gonzalez</p>
              <p className="text-white/30 text-xs truncate">NextKey PS</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full text-left text-white/30 hover:text-white/60 text-xs transition-colors px-1"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
