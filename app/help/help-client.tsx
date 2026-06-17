'use client'

import { useState } from 'react'

type Category = 'getting-started' | 'leads' | 'contacts' | 'pipeline' | 'documents' | 'inbox' | 'admin'

interface FAQ { q: string; a: string }
interface DocSection { id: Category; label: string; icon: string; faqs: FAQ[] }

const SECTIONS: DocSection[] = [
  {
    id: 'getting-started', label: 'Getting Started', icon: '🚀',
    faqs: [
      { q: 'How do I set up my profile?', a: 'Go to your avatar menu → My Profile. Fill in your name, phone, email, brokerage, and optional signature. This data auto-fills into all contracts and documents.' },
      { q: 'How do I connect Gmail?', a: 'Go to Integrations → click "Connect Gmail." You\'ll authorize access via Google OAuth. Once connected, emails appear in your Inbox module.' },
      { q: 'What do the different roles mean?', a: 'Owner has full access including API Keys. Admin can manage company settings and team members. Member can use all client-facing modules. Viewer has read-only access.' },
      { q: 'How is my data stored?', a: 'All data is stored in Supabase with row-level security — you only see your own records unless you\'re an admin or owner.' },
    ],
  },
  {
    id: 'leads', label: 'Leads', icon: '📋',
    faqs: [
      { q: 'What\'s the difference between a Lead and a Contact?', a: 'Leads are property-level records — a specific address + seller/buyer. Contacts are people records. A lead may reference an existing contact, or you can add contact details directly to the lead.' },
      { q: 'How do I add a lead manually?', a: 'Go to Leads → click "New Lead." Enter the property address and any seller information. You can also import leads from a CSV or pull data from REAPI.' },
      { q: 'What does "Skip Trace" mean?', a: 'Skip tracing finds contact info for a property owner using public records. Enter the info manually using your own sources — automated skip trace lookup is not yet available.' },
      { q: 'How do I set a follow-up date?', a: 'Open any lead or contact → find the Follow-Up Date field → pick a date. Leads with past-due follow-ups appear in the Contacts → Due Today view.' },
    ],
  },
  {
    id: 'contacts', label: 'Contacts', icon: '👥',
    faqs: [
      { q: 'How do I organize contacts?', a: 'Use tags and the contact type field (Seller, Buyer, Agent, Investor, etc.). You can filter by any tag or type in the contacts table.' },
      { q: 'Can I add a note to a contact?', a: 'Yes — open any contact and scroll to the Notes section. Notes are timestamped and visible in the contact\'s activity history.' },
      { q: 'What are Tasks?', a: 'Tasks are to-dos attached to a specific contact. You can assign a due date, mark them complete, and filter contacts by task status.' },
    ],
  },
  {
    id: 'pipeline', label: 'Pipeline', icon: '🤝',
    faqs: [
      { q: 'How does the Pipeline kanban work?', a: 'Each column represents a deal stage (Lead → Offer → Under Contract → Closed, etc.). Drag cards between columns to update deal status. Totals are calculated automatically.' },
      { q: 'How do I add a deal to the pipeline?', a: 'Open a Lead and click "Add to Pipeline," or go to Pipeline and click "+ New Deal." Link it to a property and contact.' },
      { q: 'Can I customize the pipeline stages?', a: 'Yes — go to Admin → Pipelines to create, rename, and reorder your pipeline stages to match your workflow.' },
    ],
  },
  {
    id: 'documents', label: 'Documents', icon: '📄',
    faqs: [
      { q: 'How does auto-fill work on documents?', a: 'When you open a document linked to a lead, deal, property, or contact — those fields are pulled in automatically. Your personal info comes from My Profile.' },
      { q: 'Can I save a signed document?', a: 'Yes — after signing, use the "Download PDF" or "Save to Records" button in the document composer. You can also re-open saved documents.' },
      { q: 'How do I add a signature block?', a: 'In the document composer, use the signature field component. Your saved signature (from My Profile) is applied automatically when you click the signature block.' },
    ],
  },
  {
    id: 'inbox', label: 'Inbox', icon: '✉️',
    faqs: [
      { q: 'Why do I need to connect Gmail?', a: 'NextKey OS sends and receives emails through your personal Gmail account via OAuth. This keeps email from your real address and stays in sync with Gmail.' },
      { q: 'Can I see emails sent outside of NextKey OS?', a: 'Yes — your Inbox syncs your full Gmail inbox. Emails sent from NextKey OS also appear in Gmail Sent.' },
      { q: 'Why can\'t I see my inbox?', a: 'Your Gmail connection may have expired. Go to Integrations and reconnect.' },
    ],
  },
  {
    id: 'admin', label: 'Admin & Settings', icon: '⚙️',
    faqs: [
      { q: 'How do I invite a team member?', a: 'Go to Admin → Users → Invite User. Enter their email and assign a role. They\'ll receive a temporary password by email.' },
      { q: 'Where do I manage contract defaults?', a: 'Go to Company Settings → Contract Defaults. Set default terms that pre-fill on every new contract created by your team.' },
      { q: 'What are Offer Profiles?', a: 'Offer Profiles are saved offer structures (e.g., "Cash 10-day close," "FHA standard") that you can apply instantly when building a new offer document.' },
      { q: 'How do I change my company name?', a: 'Go to Company Settings → Company Information. Update your name, brokerage, license number, and address there.' },
    ],
  },
]

const S = {
  sectionLabel: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 14 },
  card: { backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '18px 20px', marginBottom: 10 } as React.CSSProperties,
}

export default function HelpClient() {
  const [activeSection, setActiveSection] = useState<Category>('getting-started')
  const [openFaq, setOpenFaq]             = useState<string | null>(null)
  const [search, setSearch]               = useState('')

  const currentSection = SECTIONS.find(s => s.id === activeSection)!

  const filteredFaqs = search.trim()
    ? SECTIONS.flatMap(s => s.faqs.filter(f => f.q.toLowerCase().includes(search.toLowerCase()) || f.a.toLowerCase().includes(search.toLowerCase())).map(f => ({ ...f, section: s.label })))
    : currentSection.faqs.map(f => ({ ...f, section: currentSection.label }))

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px', color: 'var(--c-primary)' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Help Center</h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-2)' }}>Guides, FAQs, and documentation for NextKey OS</p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 28, position: 'relative' }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text-2)', fontSize: 16 }}>🔍</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search help articles…"
          style={{ width: '100%', padding: '11px 14px 11px 40px', borderRadius: 10, fontSize: 14, border: '1px solid var(--c-border)', backgroundColor: 'var(--c-input-bg)', color: 'var(--c-primary)', boxSizing: 'border-box' }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-2)', fontSize: 18, lineHeight: 1 }}>×</button>
        )}
      </div>

      {search.trim() ? (
        /* Search results */
        <section>
          <p style={S.sectionLabel}>{filteredFaqs.length} Result{filteredFaqs.length !== 1 ? 's' : ''}</p>
          {filteredFaqs.length === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🤷</div>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No results</p>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Try different keywords or browse the sections below.</p>
            </div>
          ) : filteredFaqs.map((faq, i) => (
            <FaqItem key={i} q={faq.q} a={faq.a} badge={faq.section} open={openFaq === `search-${i}`} onToggle={() => setOpenFaq(openFaq === `search-${i}` ? null : `search-${i}`)} />
          ))}
        </section>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24 }}>

          {/* Sidebar nav */}
          <nav>
            <p style={S.sectionLabel}>Sections</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {SECTIONS.map(sec => (
                <button key={sec.id} onClick={() => setActiveSection(sec.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  textAlign: 'left', cursor: 'pointer', border: 'none',
                  backgroundColor: activeSection === sec.id ? 'rgba(201,168,76,0.12)' : 'transparent',
                  color: activeSection === sec.id ? '#C9A84C' : 'var(--c-text-2)',
                }}>
                  <span>{sec.icon}</span> {sec.label}
                </button>
              ))}
            </div>
          </nav>

          {/* FAQ list */}
          <div>
            <p style={S.sectionLabel}>{currentSection.label}</p>
            {currentSection.faqs.map((faq, i) => (
              <FaqItem key={i} q={faq.q} a={faq.a} open={openFaq === `${activeSection}-${i}`} onToggle={() => setOpenFaq(openFaq === `${activeSection}-${i}` ? null : `${activeSection}-${i}`)} />
            ))}
          </div>
        </div>
      )}

      {/* Training videos placeholder */}
      <section style={{ marginTop: 36, paddingTop: 28, borderTop: '1px solid var(--c-border)' }}>
        <p style={S.sectionLabel}>Training Videos</p>
        <div style={{ ...S.card, opacity: 0.7, textAlign: 'center', padding: '32px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎬</div>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Video tutorials coming soon</p>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Screen recordings for each module will be added in a future update.</p>
        </div>
      </section>

      {/* Contact */}
      <section style={{ marginTop: 28 }}>
        <p style={S.sectionLabel}>Still Need Help?</p>
        <div style={S.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <p style={{ fontWeight: 600, marginBottom: 3 }}>Contact Support</p>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)' }}>Reach out for platform issues, bugs, or feature requests.</p>
            </div>
            <a href="mailto:charlesgonzalez@nextkeyps.com" style={{ padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#C9A84C', color: '#0A1F44', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
              Email Support
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}

function FaqItem({ q, a, badge, open, onToggle }: { q: string; a: string; badge?: string; open: boolean; onToggle: () => void }) {
  return (
    <div style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, marginBottom: 8, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {badge && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', marginBottom: 4, display: 'inline-block' }}>{badge}</span>}
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-primary)' }}>{q}</p>
        </div>
        <span style={{ color: 'var(--c-text-2)', fontSize: 18, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>›</span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--c-border)', paddingTop: 14 }}>
          <p style={{ fontSize: 14, color: 'var(--c-text-2)', lineHeight: 1.6 }}>{a}</p>
        </div>
      )}
    </div>
  )
}
