'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Home, ClipboardList, Key, Users,
  Search, Lightbulb, Briefcase, TrendingUp, MapPin,
  FileText, PenLine, BarChart3, Mail, Zap, Building2,
} from 'lucide-react'
import { platform } from '@/content/platform-marketing'

// ── Scroll-reveal hook ────────────────────────────────────────────────────────

function useScrollReveal() {
  useEffect(() => {
    // Trigger elements already in viewport immediately
    const trigger = (el: Element) => el.classList.add('nk-visible')

    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) trigger(e.target) }),
      { threshold: 0.08, rootMargin: '0px 0px -20px 0px' }
    )
    document.querySelectorAll('.nk-reveal').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])
}

// ── Inline logo mark ──────────────────────────────────────────────────────────

function NKMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 192 192" aria-hidden="true">
      <rect width="192" height="192" rx="38" fill="#0A1F44" />
      <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle"
        fontFamily="system-ui,-apple-system,sans-serif" fontWeight="800"
        fontSize="82" letterSpacing="-3" fill="#C9A84C">NK</text>
    </svg>
  )
}

// ── Product preview placeholder ───────────────────────────────────────────────

interface ProductPreviewProps {
  src?: string
  alt: string
  caption?: string
  screenshotId: string
  label: string
  orientation?: 'landscape' | 'portrait'
}

function ProductPreview({ src, alt, caption, screenshotId, label, orientation = 'landscape' }: ProductPreviewProps) {
  const aspectRatio = orientation === 'landscape' ? '16/10' : '3/4'
  return (
    <figure className="w-full">
      <div
        style={{
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.32), 0 4px 16px rgba(0,0,0,0.2)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Browser chrome */}
        <div style={{ background: '#1a2f5a', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['#FF5F57','#FEBC2E','#28C840'].map((c, i) => (
              <div key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: c, opacity: 0.8 }} />
            ))}
          </div>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.07)', borderRadius: 6, height: 22, display: 'flex', alignItems: 'center', padding: '0 10px' }}>
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontFamily: 'inherit' }}>nextkey.app</span>
          </div>
        </div>
        {/* Screenshot area */}
        <div style={{ aspectRatio, position: 'relative', background: '#0c1d3d' }}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              padding: 24, textAlign: 'center',
            }}>
              <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#C9A84C" strokeWidth="1.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <div>
                <p style={{ color: 'rgba(201,168,76,0.8)', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                  {label}
                </p>
                <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>
                  Screenshot ref: {screenshotId}
                </p>
                <p style={{ color: 'rgba(255,255,255,0.18)', fontSize: 10, marginTop: 4 }}>
                  Sanitized demo data only — never real homeowner information
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      {caption && (
        <figcaption style={{ textAlign: 'center', marginTop: 12, fontSize: 13, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  id,
  children,
  dark = false,
  className = '',
  style = {},
}: {
  id?: string
  children: React.ReactNode
  dark?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <section
      id={id}
      style={{
        padding: '96px 0',
        backgroundColor: dark ? '#0A1F44' : '#F8F7F4',
        ...style,
      }}
      className={className}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
        {children}
      </div>
    </section>
  )
}

// ── Eyebrow label ─────────────────────────────────────────────────────────────

function Eyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: '#C9A84C',
      marginBottom: 16,
      opacity: light ? 0.85 : 1,
    }}>
      {children}
    </p>
  )
}

// ── Navigation ────────────────────────────────────────────────────────────────

function NavBar({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  const links = [
    { label: 'Product',      href: '#product'    },
    { label: 'Solutions',    href: '#solutions'  },
    { label: 'How It Works', href: '#workflow'   },
    { label: 'Pricing',      href: '#pricing'    },
    { label: 'About',        href: '#about'      },
  ]

  const scrollTo = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!href.startsWith('#')) return
    e.preventDefault()
    setMenuOpen(false)
    const el = document.getElementById(href.slice(1))
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9000,
        backgroundColor: scrolled ? 'rgba(10,31,68,0.97)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
        transition: 'background-color 0.2s, border-color 0.2s, backdrop-filter 0.2s',
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

        {/* Logo */}
        <Link href="/" aria-label="NextKey home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
          <NKMark size={30} />
          <span style={{ color: '#C9A84C', fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>NextKey</span>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14, fontWeight: 500 }}>OS</span>
        </Link>

        {/* Desktop nav links */}
        <div className="nk-desktop-nav" role="list" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {links.map(l => (
            <a
              key={l.href}
              href={l.href}
              onClick={e => scrollTo(e, l.href)}
              role="listitem"
              style={{
                color: 'rgba(255,255,255,0.65)',
                fontSize: 14,
                fontWeight: 500,
                padding: '6px 12px',
                borderRadius: 8,
                textDecoration: 'none',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.65)')}
            >
              {l.label}
            </a>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="nk-desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a
            href={isAuthenticated ? platform.dashboardHref : platform.loginHref}
            style={{
              color: 'rgba(255,255,255,0.7)',
              fontSize: 14,
              fontWeight: 600,
              padding: '8px 16px',
              textDecoration: 'none',
              borderRadius: 8,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
          >
            {isAuthenticated ? 'Dashboard →' : 'Log In'}
          </a>
          {!isAuthenticated && (
            <a
              href="#pricing"
              onClick={e => scrollTo(e, '#pricing')}
              style={{
                backgroundColor: '#C9A84C',
                color: '#0A1F44',
                fontSize: 14,
                fontWeight: 700,
                padding: '9px 20px',
                borderRadius: 10,
                textDecoration: 'none',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              Get Started
            </a>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="nk-mobile-menu-btn"
          onClick={() => setMenuOpen(v => !v)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.7)', padding: 8,
          }}
        >
          {menuOpen ? (
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div style={{
          backgroundColor: 'rgba(10,31,68,0.98)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '16px 24px 24px',
        }}>
          {links.map(l => (
            <a
              key={l.href}
              href={l.href}
              onClick={e => scrollTo(e, l.href)}
              style={{
                display: 'block',
                color: 'rgba(255,255,255,0.8)',
                fontSize: 16,
                fontWeight: 500,
                padding: '14px 0',
                textDecoration: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {l.label}
            </a>
          ))}
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a
              href={isAuthenticated ? platform.dashboardHref : platform.loginHref}
              style={{
                display: 'block', textAlign: 'center',
                color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: 600,
                padding: '12px 0', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, textDecoration: 'none',
              }}
            >
              {isAuthenticated ? 'Go to Dashboard' : 'Log In'}
            </a>
            {!isAuthenticated && (
              <a
                href="#pricing"
                onClick={e => scrollTo(e, '#pricing')}
                style={{
                  display: 'block', textAlign: 'center',
                  backgroundColor: '#C9A84C', color: '#0A1F44',
                  fontSize: 15, fontWeight: 700,
                  padding: '13px 0', borderRadius: 10, textDecoration: 'none',
                }}
              >
                Get Started
              </a>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section
      id="product"
      style={{
        backgroundColor: '#0A1F44',
        paddingTop: 140,
        paddingBottom: 100,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle grid overlay */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(rgba(201,168,76,0.06) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        pointerEvents: 'none',
      }} />
      {/* Gold glow */}
      <div aria-hidden="true" style={{
        position: 'absolute', top: -120, right: -80, width: 600, height: 600,
        background: 'radial-gradient(circle, rgba(201,168,76,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', position: 'relative' }}>
        <div className="nk-hero-grid">

          {/* Left: copy */}
          <div className="nk-hero-copy nk-reveal">
            <Eyebrow>Real Estate Operating Platform</Eyebrow>
            <h1 style={{
              color: '#fff',
              fontSize: 'clamp(36px, 5vw, 62px)',
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: '-0.03em',
              marginBottom: 24,
              textWrap: 'balance',
            }}>
              Find the opportunity.<br />
              <span style={{ color: '#C9A84C' }}>Understand</span> the property.<br />
              Work the deal.
            </h1>
            <p style={{
              color: 'rgba(255,255,255,0.6)',
              fontSize: 18,
              lineHeight: 1.65,
              marginBottom: 40,
              maxWidth: 520,
            }}>
              One workspace for property intelligence, relationship management, and deal
              execution, from initial search to close. No context lost between systems.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <a
                href="#workflow"
                onClick={(e: React.MouseEvent<HTMLAnchorElement>) => { e.preventDefault(); document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' }) }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  backgroundColor: '#C9A84C', color: '#0A1F44',
                  fontSize: 15, fontWeight: 700,
                  padding: '14px 28px', borderRadius: 12, textDecoration: 'none',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                Explore the Platform
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
              <a
                href={platform.loginHref}
                style={{
                  display: 'inline-flex', alignItems: 'center',
                  color: 'rgba(255,255,255,0.75)',
                  fontSize: 15, fontWeight: 600,
                  padding: '14px 24px', borderRadius: 12, textDecoration: 'none',
                  border: '1px solid rgba(255,255,255,0.18)',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)' }}
              >
                Log In
              </a>
            </div>
            {/* Trust signals */}
            <div style={{ marginTop: 48, display: 'flex', flexWrap: 'wrap', gap: 24 }}>
              {[
                'Built by working real estate professionals',
                'Property-first, not lead-first',
                'One workspace, not ten tools',
              ].map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#C9A84C" strokeWidth="2.5" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>{s}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: product preview */}
          <div className="nk-hero-media nk-reveal" style={{ transitionDelay: '0.1s' }}>
            <ProductPreview
              alt="NextKey OS — Property Workspace"
              screenshotId="01-property-workspace"
              label="Property Workspace"
              caption="The property workspace: every detail, contact, comp, and document in one place."
            />
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Problem ───────────────────────────────────────────────────────────────────

function ProblemSection() {
  const tools = [
    'Property data', 'County records', 'Lead lists',
    'CRM', 'Comp analysis', 'Document storage',
    'Follow-up tracking', 'Deal pipeline', 'Communication logs',
  ]
  return (
    <Section id="solutions" dark={false}>
      <div className="nk-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 64px' }}>
        <Eyebrow>The Problem</Eyebrow>
        <h2 style={{ fontSize: 'clamp(28px, 4vw, 46px)', fontWeight: 800, color: '#0A1F44', lineHeight: 1.15, letterSpacing: '-0.025em', marginBottom: 20 }}>
          Real Estate Shouldn&apos;t Require Ten Disconnected Tools.
        </h2>
        <p style={{ fontSize: 16, color: '#4b5563', lineHeight: 1.7 }}>
          The property, the owner, the research, the communication, and the deal live in
          separate systems. Every time you switch tools you lose context, and losing context
          means losing deals.
        </p>
      </div>

      {/* Fragmented tools → unified */}
      <div className="nk-reveal" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginBottom: 48 }}>
        {tools.map(t => (
          <div
            key={t}
            style={{
              background: '#fff',
              border: '1.5px solid #e5e7eb',
              borderRadius: 10,
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 600,
              color: '#374151',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}
          >
            {t}
          </div>
        ))}
      </div>

      <div className="nk-reveal" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#C9A84C" strokeWidth="2.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        <div style={{
          background: '#0A1F44', color: '#C9A84C',
          fontWeight: 800, fontSize: 15, letterSpacing: '-0.01em',
          padding: '14px 32px', borderRadius: 14,
          boxShadow: '0 8px 32px rgba(10,31,68,0.2)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <NKMark size={24} />
          One {platform.productName} workspace
        </div>
        <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 440, textAlign: 'center', marginTop: 8 }}>
          Property intelligence, owner research, contact management, and deal execution, all connected to the same property record.
        </p>
      </div>
    </Section>
  )
}

// ── One Property, One Workspace ───────────────────────────────────────────────

function WorkspaceSection() {
  return (
    <Section dark style={{ padding: '96px 0' }}>
      <div className="nk-feature-grid nk-reveal">
        <div className="nk-feature-copy">
          <Eyebrow>Core Architecture</Eyebrow>
          <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 800, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.025em', marginBottom: 20 }}>
            One Property.<br />One Workspace.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, lineHeight: 1.7, marginBottom: 28 }}>
            A property doesn&apos;t need to become a lead before you can research it. Open any
            property, review ownership and distress signals, pull comps, and enrich details.
            Then decide whether to save and work the opportunity.
          </p>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, lineHeight: 1.7, marginBottom: 36 }}>
            Everything ties back to the property record: notes, contacts, documents,
            comparable sales, and deal timeline, all in one place.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              'Property details, ownership, and equity at a glance',
              'Comparable sales linked directly to the property',
              'Contacts and communications in context',
              'Documents associated with the deal, not a folder',
            ].map(item => (
              <li key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#C9A84C" strokeWidth="2.5" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 15 }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="nk-feature-media" style={{ transitionDelay: '0.1s' }}>
          <ProductPreview
            alt="NextKey OS — Property Workspace Detail"
            screenshotId="04-property-workspace"
            label="Property Workspace (/properties/[id])"
            caption="All property intelligence in one connected workspace."
          />
        </div>
      </div>
    </Section>
  )
}

// ── Property Discovery ────────────────────────────────────────────────────────

function DiscoverySection() {
  const capabilities = [
    'Single-address property lookup',
    'Criteria-based bulk search',
    'Distress and equity filtering',
    'Occupancy and ownership type filters',
    'Geographic and map-based search',
    'Foreclosure and probate indicators',
  ]
  return (
    <Section dark={false}>
      <div className="nk-feature-grid nk-feature-grid--reverse nk-reveal">
        <div className="nk-feature-copy">
          <Eyebrow>Property Discovery</Eyebrow>
          <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 800, color: '#0A1F44', lineHeight: 1.15, letterSpacing: '-0.025em', marginBottom: 20 }}>
            Find Opportunities Before They Become Obvious.
          </h2>
          <p style={{ color: '#4b5563', fontSize: 16, lineHeight: 1.7, marginBottom: 28 }}>
            Search individual addresses or apply layered criteria to surface distressed,
            high-equity, or off-market opportunities at scale.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {capabilities.map(c => (
              <li key={c} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#C9A84C" strokeWidth="2.5" aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span style={{ color: '#374151', fontSize: 15 }}>{c}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="nk-feature-media" style={{ transitionDelay: '0.1s' }}>
          <ProductPreview
            alt="NextKey OS — Property Search"
            screenshotId="02-property-search"
            label="Property Search"
            caption="Criteria-based property discovery with distress and equity filters."
          />
        </div>
      </div>
    </Section>
  )
}

// ── Property Intelligence ─────────────────────────────────────────────────────

function IntelligenceSection() {
  const signals = [
    { label: 'Ownership', desc: 'Current owner, mailing address, vesting' },
    { label: 'Equity', desc: 'Estimated equity position and tier classification' },
    { label: 'Distress Signals', desc: 'Foreclosure, probate, and public-record distress indicators' },
    { label: 'Comparable Sales', desc: 'Active, pending, and sold comps within radius' },
    { label: 'Property Details', desc: 'Beds, baths, sqft, year built, lot size, and more' },
    { label: 'Property History', desc: 'Prior sales, listing cycles, and price history' },
  ]
  return (
    <Section dark id="intelligence">
      <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 64px' }} className="nk-reveal">
        <Eyebrow light>Property Intelligence</Eyebrow>
        <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 800, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.025em', marginBottom: 20 }}>
          Turn Property Data Into Actionable Intelligence.
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 16, lineHeight: 1.7 }}>
          Pull together ownership, equity, distress, comparables, and history, so you understand what you&apos;re looking at before making contact.
        </p>
      </div>
      <div className="nk-grid-3 nk-reveal">
        {signals.map(s => (
          <div
            key={s.label}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 14,
              padding: '24px',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(201,168,76,0.3)'; e.currentTarget.style.background = 'rgba(201,168,76,0.05)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
          >
            <p style={{ color: '#C9A84C', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{s.label}</p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 1.6 }}>{s.desc}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── CRM / Relationships ───────────────────────────────────────────────────────

function RelationshipsSection() {
  return (
    <Section dark={false}>
      <div className="nk-feature-grid nk-reveal">
        <div className="nk-feature-copy">
          <Eyebrow>CRM & Relationships</Eyebrow>
          <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 800, color: '#0A1F44', lineHeight: 1.15, letterSpacing: '-0.025em', marginBottom: 20 }}>
            From Property Research to Real Relationships.
          </h2>
          <p style={{ color: '#4b5563', fontSize: 16, lineHeight: 1.7, marginBottom: 28 }}>
            When a researched property becomes worth working, convert it into an active
            opportunity without losing the intelligence you already collected.
          </p>
          {/* Transition flow */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 32 }}>
            {['Property', 'Opportunity', 'Contact', 'Active Deal'].map((step, i, arr) => (
              <Fragment key={step}>
                <span
                  style={{
                    background: i === 0 ? 'rgba(10,31,68,0.08)' : i === arr.length - 1 ? '#C9A84C' : '#0A1F44',
                    color: i === 0 ? '#0A1F44' : '#fff',
                    fontWeight: 700,
                    fontSize: 13,
                    padding: '6px 14px',
                    borderRadius: 8,
                  }}
                >
                  {step}
                </span>
                {i < arr.length - 1 && (
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" strokeWidth="2.5" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                )}
              </Fragment>
            ))}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              'Contacts with property relationships',
              'Leads with status and pipeline stage',
              'Deal workspace linked to the property',
              'Notes, tasks, and activity log',
              'Contact-to-property associations',
            ].map(item => (
              <li key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#C9A84C" strokeWidth="2.5" aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span style={{ color: '#374151', fontSize: 15 }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="nk-feature-media" style={{ transitionDelay: '0.1s' }}>
          <ProductPreview
            alt="NextKey OS — CRM & Contacts"
            screenshotId="06-contacts"
            label="CRM & Contacts"
            caption="Contacts, leads, and deals connected to property records."
          />
        </div>
      </div>
    </Section>
  )
}

// ── Documents ─────────────────────────────────────────────────────────────────

function DocumentsSection() {
  return (
    <Section dark style={{ padding: '96px 0' }}>
      <div className="nk-feature-grid nk-feature-grid--reverse nk-reveal">
        <div className="nk-feature-copy">
          <Eyebrow light>Native Documents</Eyebrow>
          <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 800, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.025em', marginBottom: 20 }}>
            Documents Where the Deal Already Lives.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, lineHeight: 1.7, marginBottom: 28 }}>
            Generate contracts and documents from templates, assign signer roles,
            and keep everything tied to the property record, with no external service required.
          </p>
          <div style={{
            background: 'rgba(201,168,76,0.08)',
            border: '1px solid rgba(201,168,76,0.2)',
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 28,
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#C9A84C" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              E-signature workflows are in active development. Native signing will be available in an upcoming release.
            </p>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              'Document generation from templates',
              'Variable substitution (property, contact, deal fields)',
              'Document library per property',
              'Native signer-role assignment (In Development)',
            ].map(item => (
              <li key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#C9A84C" strokeWidth="2.5" aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15 }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="nk-feature-media" style={{ transitionDelay: '0.1s' }}>
          <ProductPreview
            alt="NextKey OS — Documents"
            screenshotId="08-documents"
            label="Documents & Templates"
            caption="Contract generation and document management in the deal workspace."
          />
        </div>
      </div>
    </Section>
  )
}

// ── Workflow ──────────────────────────────────────────────────────────────────

function WorkflowSection() {
  const steps = [
    { step: '01', label: 'Search',    desc: 'Find properties by address or criteria' },
    { step: '02', label: 'Research',  desc: 'Pull ownership, equity, and distress signals' },
    { step: '03', label: 'Understand', desc: 'Review comps, history, and property context' },
    { step: '04', label: 'Save',      desc: 'Convert a researched property into an opportunity' },
    { step: '05', label: 'Connect',   desc: 'Add contacts and build the relationship' },
    { step: '06', label: 'Work',      desc: 'Move the deal through your pipeline' },
    { step: '07', label: 'Document',  desc: 'Generate and manage deal documents' },
    { step: '08', label: 'Close',     desc: 'Track the outcome in the deal record' },
  ]
  return (
    <Section id="workflow" dark={false} style={{ background: '#fff', padding: '96px 0' }}>
      <div style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto 64px' }} className="nk-reveal">
        <Eyebrow>How It Works</Eyebrow>
        <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 800, color: '#0A1F44', lineHeight: 1.15, letterSpacing: '-0.025em', marginBottom: 20 }}>
          From Search to Close, Without Losing the Story of the Property.
        </h2>
        <p style={{ color: '#6b7280', fontSize: 16, lineHeight: 1.7 }}>
          Every step stays connected to the same property record, so context never disappears between phases of the deal.
        </p>
      </div>
      <div className="nk-workflow-grid nk-reveal">
        {steps.map((s, i) => (
          <div key={s.step} style={{ position: 'relative' }}>
            {/* Connector line — right side, not on last in row */}
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid #e5e7eb',
              borderRadius: 16,
              padding: '24px 20px',
              height: '100%',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#C9A84C'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(201,168,76,0.12)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: '#0A1F44', color: '#C9A84C',
                  fontWeight: 800, fontSize: 12, letterSpacing: '0.02em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {s.step}
                </span>
                <span style={{ fontWeight: 700, fontSize: 16, color: '#0A1F44' }}>{s.label}</span>
              </div>
              <p style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
            </div>
            {/* Gold connector arrow between steps */}
            {i < steps.length - 1 && (
              <div className="nk-step-connector" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Built For ─────────────────────────────────────────────────────────────────

function AudienceSection() {
  const audiences: { label: string; Icon: React.ElementType; desc: string }[] = [
    {
      label: 'Real Estate Investors',
      Icon: Home,
      desc: 'Find and evaluate opportunities while keeping property intelligence connected to execution. Research distress signals, evaluate comps, and manage deal flow from one place.',
    },
    {
      label: 'Wholesalers',
      Icon: ClipboardList,
      desc: 'Research distressed properties, organize opportunities, manage seller contacts, and track assignments through a structured pipeline workflow.',
    },
    {
      label: 'Agents',
      Icon: Key,
      desc: 'Research properties and manage client relationships with deeper property context than any standard CRM provides.',
    },
    {
      label: 'Small Teams',
      Icon: Users,
      desc: 'Operate from a shared workspace instead of distributing information across disconnected spreadsheets, inboxes, and CRM tools.',
    },
  ]
  return (
    <Section dark style={{ padding: '96px 0' }}>
      <div style={{ textAlign: 'center', maxWidth: 580, margin: '0 auto 64px' }} className="nk-reveal">
        <Eyebrow light>Built For</Eyebrow>
        <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 800, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.025em' }}>
          Professionals Who Work Real Estate Seriously.
        </h2>
      </div>
      <div className="nk-grid-2 nk-reveal">
        {audiences.map(a => (
          <div
            key={a.label}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 18,
              padding: '32px 28px',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(201,168,76,0.3)'; e.currentTarget.style.background = 'rgba(201,168,76,0.04)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
          >
            <div style={{ marginBottom: 16 }} aria-hidden="true">
              <a.Icon size={32} strokeWidth={1.5} color="#C9A84C" />
            </div>
            <h3 style={{ color: '#fff', fontWeight: 700, fontSize: 18, marginBottom: 12 }}>{a.label}</h3>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, lineHeight: 1.7 }}>{a.desc}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Platform Modules ──────────────────────────────────────────────────────────

function ModulesSection() {
  const modules: { label: string; Icon: React.ElementType; status: string }[] = [
    { label: 'Property Search',      Icon: Search,        status: 'live'   },
    { label: 'Property Intelligence', Icon: Lightbulb,    status: 'live'   },
    { label: 'CRM & Contacts',       Icon: Users,         status: 'live'   },
    { label: 'Deal Workspace',       Icon: Briefcase,     status: 'live'   },
    { label: 'Comparable Sales',     Icon: TrendingUp,    status: 'live'   },
    { label: 'Driving for Dollars',  Icon: MapPin,        status: 'live'   },
    { label: 'Documents',            Icon: FileText,      status: 'live'   },
    { label: 'E-Signature',          Icon: PenLine,       status: 'dev'    },
    { label: 'Reports & Analytics',  Icon: BarChart3,     status: 'live'   },
    { label: 'Communications',       Icon: Mail,          status: 'live'   },
    { label: 'AI Intelligence',      Icon: Zap,           status: 'live'   },
    { label: 'Team Management',      Icon: Building2,     status: 'soon'   },
  ]
  const statusLabel: Record<string, string> = {
    live: 'Live',
    dev:  'In Development',
    soon: 'Coming Soon',
  }
  const statusColor: Record<string, string> = {
    live: '#C9A84C',
    dev:  'rgba(255,255,255,0.35)',
    soon: 'rgba(255,255,255,0.2)',
  }
  return (
    <Section dark={false} style={{ background: '#F0F2F5', padding: '96px 0' }}>
      <div style={{ textAlign: 'center', maxWidth: 580, margin: '0 auto 56px' }} className="nk-reveal">
        <Eyebrow>Platform Modules</Eyebrow>
        <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 800, color: '#0A1F44', lineHeight: 1.15, letterSpacing: '-0.025em' }}>
          Everything a Real Estate Operation Needs.
        </h2>
      </div>
      <div className="nk-grid-4 nk-reveal">
        {modules.map(m => (
          <div
            key={m.label}
            style={{
              background: '#fff',
              border: '1.5px solid #e5e7eb',
              borderRadius: 14,
              padding: '22px 18px',
              transition: 'border-color 0.2s, box-shadow 0.2s',
              opacity: m.status === 'soon' ? 0.65 : 1,
            }}
            onMouseEnter={e => { if (m.status !== 'soon') { e.currentTarget.style.borderColor = '#C9A84C'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(201,168,76,0.1)' } }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none' }}
          >
            <div style={{ marginBottom: 10 }} aria-hidden="true">
              <m.Icon size={22} strokeWidth={1.5} color={m.status === 'soon' ? 'rgba(10,31,68,0.25)' : '#0A1F44'} />
            </div>
            <p style={{ fontWeight: 700, fontSize: 14, color: '#111827', marginBottom: 6 }}>{m.label}</p>
            <span style={{
              fontSize: 11, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              color: statusColor[m.status],
            }}>
              {statusLabel[m.status]}
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Mission / About ───────────────────────────────────────────────────────────

function MissionSection() {
  return (
    <Section id="about" dark style={{ background: '#071529', padding: '96px 0' }}>
      <div className="nk-reveal" style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <Eyebrow light>Our Mission</Eyebrow>
        <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 800, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.025em', marginBottom: 32 }}>
          Built from the Real Problems Behind Real Properties.
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 17, lineHeight: 1.8, marginBottom: 28 }}>
          NextKey began with a simple belief: better information creates better options. After years
          of working through foreclosure, probate, distressed properties, investor acquisitions,
          and traditional real estate transactions, we saw how fragmented the technology was.
        </p>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 17, lineHeight: 1.8, marginBottom: 28 }}>
          Property data lived in one place. Contacts in another. Documents somewhere else.
          Critical context disappeared between systems, and with it, the complete picture of
          what a property and its owner actually needed.
        </p>
        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 17, lineHeight: 1.8, fontStyle: 'italic' }}>
          We&apos;re building the platform we wished existed.
        </p>
        <div style={{
          marginTop: 48,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
        }}>
          <NKMark size={36} />
          <div style={{ textAlign: 'left' }}>
            <p style={{ color: '#C9A84C', fontWeight: 700, fontSize: 15 }}>{platform.companyName}</p>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Real estate technology, built by practitioners</p>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── Pricing ───────────────────────────────────────────────────────────────────

function PricingSection() {
  return (
    <Section id="pricing" dark={false} style={{ background: '#fff', padding: '96px 0' }}>
      <div style={{ textAlign: 'center', maxWidth: 580, margin: '0 auto 56px' }} className="nk-reveal">
        <Eyebrow>Pricing</Eyebrow>
        <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 800, color: '#0A1F44', lineHeight: 1.15, letterSpacing: '-0.025em', marginBottom: 20 }}>
          Plans for Every Stage of Growth.
        </h2>
        <p style={{ color: '#6b7280', fontSize: 16, lineHeight: 1.7 }}>
          Pricing is being finalized as we prepare {platform.productName} for broader access.
        </p>
      </div>

      {/* Early access card */}
      <div className="nk-reveal" style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{
          background: '#0A1F44',
          borderRadius: 20,
          padding: '40px 36px',
          textAlign: 'center',
          boxShadow: '0 24px 80px rgba(10,31,68,0.2)',
          border: '1px solid rgba(201,168,76,0.25)',
        }}>
          <span style={{
            display: 'inline-block',
            background: 'rgba(201,168,76,0.15)',
            color: '#C9A84C',
            fontWeight: 700, fontSize: 12,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            padding: '6px 14px', borderRadius: 8, marginBottom: 24,
          }}>
            Early Access
          </span>
          <h3 style={{ color: '#fff', fontWeight: 800, fontSize: 26, marginBottom: 16 }}>
            Get Early Access
          </h3>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 15, lineHeight: 1.7, marginBottom: 32 }}>
            Plans are being finalized for broader release. Early access gives you the full
            platform while we complete pricing configuration.
          </p>
          <a
            href={platform.loginHref}
            style={{
              display: 'block',
              backgroundColor: '#C9A84C', color: '#0A1F44',
              fontWeight: 700, fontSize: 15,
              padding: '15px 0', borderRadius: 12,
              textDecoration: 'none', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Request Early Access
          </a>
          <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, marginTop: 20 }}>
            Invitation-based early access. No payment required to apply.
          </p>
        </div>
      </div>
    </Section>
  )
}

// ── Final CTA ─────────────────────────────────────────────────────────────────

function FinalCTASection() {
  return (
    <section style={{
      background: 'linear-gradient(135deg, #0A1F44 0%, #122550 60%, #0d2347 100%)',
      padding: '100px 0',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div aria-hidden="true" style={{
        position: 'absolute', bottom: -100, left: -100, width: 500, height: 500,
        background: 'radial-gradient(circle, rgba(201,168,76,0.1) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 24px', textAlign: 'center', position: 'relative' }} className="nk-reveal">
        <h2 style={{ color: '#fff', fontSize: 'clamp(28px, 4vw, 50px)', fontWeight: 800, lineHeight: 1.12, letterSpacing: '-0.025em', marginBottom: 20 }}>
          One Place to Find It,<br />
          <span style={{ color: '#C9A84C' }}>Understand It,</span><br />
          and Move It Forward.
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 17, lineHeight: 1.7, marginBottom: 40, maxWidth: 500, margin: '0 auto 40px' }}>
          Bring property intelligence, relationships, and deal execution into one workspace.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14 }}>
          <a
            href="#workflow"
            onClick={(e: React.MouseEvent<HTMLAnchorElement>) => { e.preventDefault(); document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' }) }}
            style={{
              backgroundColor: '#C9A84C', color: '#0A1F44',
              fontWeight: 700, fontSize: 15,
              padding: '14px 32px', borderRadius: 12,
              textDecoration: 'none', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Explore the Platform
          </a>
          <a
            href={platform.loginHref}
            style={{
              color: 'rgba(255,255,255,0.75)',
              fontWeight: 600, fontSize: 15,
              padding: '14px 28px', borderRadius: 12,
              textDecoration: 'none',
              border: '1px solid rgba(255,255,255,0.2)',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.45)'; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)' }}
          >
            Log In
          </a>
        </div>
      </div>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  const links = [
    { label: 'Product',   href: '#product'   },
    { label: 'Solutions', href: '#solutions'  },
    { label: 'About',     href: '#about'      },
    { label: 'Log In',    href: platform.loginHref },
  ]
  return (
    <footer style={{ background: '#060F1E', padding: '48px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }} role="contentinfo">
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
        <div className="nk-footer-grid">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <NKMark size={26} />
              <span style={{ color: '#C9A84C', fontWeight: 800, fontSize: 16 }}>NextKey</span>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>OS</span>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, lineHeight: 1.6, maxWidth: 280 }}>
              Built by {platform.companyName}. A real estate operating platform for property
              intelligence, relationships, and deal execution.
            </p>
          </div>
          <nav aria-label="Footer navigation">
            <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>Navigation</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {links.map(l => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, textDecoration: 'none', transition: 'color 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          marginTop: 40, paddingTop: 24,
          display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
            © {new Date().getFullYear()} {platform.companyName}. All rights reserved.
          </p>
          <p style={{ color: 'rgba(255,255,255,0.15)', fontSize: 12 }}>
            {platform.productName} · Private Early Access
          </p>
        </div>
      </div>
    </footer>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function LandingPage({ isAuthenticated }: { isAuthenticated: boolean }) {
  useScrollReveal()

  return (
    <>
      {/* Inline landing-page styles */}
      <style>{`
        /* Override app-shell height constraints — let the marketing page scroll normally */
        html { height: auto !important; overflow: visible !important; }
        body { height: auto !important; min-height: 100vh; overflow: visible !important; }

        /* Reset for marketing page */
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* Scroll-reveal */
        .nk-reveal {
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.55s ease, transform 0.55s ease;
        }
        .nk-reveal.nk-visible {
          opacity: 1;
          transform: translateY(0);
        }
        @media (prefers-reduced-motion: reduce) {
          .nk-reveal { opacity: 1; transform: none; transition: none; }
        }

        /* Desktop nav visibility */
        .nk-desktop-nav { display: flex; }
        .nk-mobile-menu-btn { display: none; }

        /* Hero grid */
        .nk-hero-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 64px;
          align-items: center;
        }

        /* Feature section grid */
        .nk-feature-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 72px;
          align-items: center;
        }
        .nk-feature-grid--reverse .nk-feature-copy { order: 2; }
        .nk-feature-grid--reverse .nk-feature-media { order: 1; }

        /* Grids */
        .nk-grid-2 {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 24px;
        }
        .nk-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
        }
        .nk-grid-4 {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        /* Workflow grid */
        .nk-workflow-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        /* Footer */
        .nk-footer-grid {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 48px;
          align-items: start;
        }

        /* Tablet */
        @media (max-width: 1024px) {
          .nk-grid-4 { grid-template-columns: repeat(3, 1fr); }
          .nk-workflow-grid { grid-template-columns: repeat(2, 1fr); }
        }

        /* Mobile */
        @media (max-width: 767px) {
          .nk-desktop-nav { display: none !important; }
          .nk-mobile-menu-btn { display: flex !important; }

          .nk-hero-grid,
          .nk-feature-grid,
          .nk-feature-grid--reverse { grid-template-columns: 1fr; gap: 40px; }

          .nk-feature-grid--reverse .nk-feature-copy { order: 0; }
          .nk-feature-grid--reverse .nk-feature-media { order: 0; }

          .nk-grid-2 { grid-template-columns: 1fr; }
          .nk-grid-3 { grid-template-columns: repeat(2, 1fr); }
          .nk-grid-4 { grid-template-columns: repeat(2, 1fr); }
          .nk-workflow-grid { grid-template-columns: 1fr; }
          .nk-footer-grid { grid-template-columns: 1fr; gap: 32px; }
        }
      `}</style>

      <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif", lineHeight: 1.5, color: '#0A1F44' }}>
        <a
          href="#product"
          style={{
            position: 'absolute', left: -9999, top: 0,
            background: '#C9A84C', color: '#0A1F44', fontWeight: 700,
            padding: '8px 16px', borderRadius: 4, zIndex: 99999,
          }}
          onFocus={e => (e.currentTarget.style.left = '8px')}
          onBlur={e => (e.currentTarget.style.left = '-9999px')}
        >
          Skip to main content
        </a>

        <NavBar isAuthenticated={isAuthenticated} />

        <main id="product">
          <HeroSection />
          <ProblemSection />
          <WorkspaceSection />
          <DiscoverySection />
          <IntelligenceSection />
          <RelationshipsSection />
          <DocumentsSection />
          <WorkflowSection />
          <AudienceSection />
          <ModulesSection />
          <MissionSection />
          <PricingSection />
          <FinalCTASection />
        </main>

        <Footer />
      </div>
    </>
  )
}
