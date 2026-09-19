'use client'

import { useState, useEffect } from 'react'

interface IntegrationCard {
  id: string
  name: string
  desc: string
  icon: string
  status: 'connected' | 'not_connected' | 'coming_soon' | 'loading'
  actionLabel?: string
  actionHref?: string
  detail?: string
}

interface NativeCapability {
  id: string
  name: string
  desc: string
  icon: string
  detail?: string
}

interface ExternalConnector {
  id: string
  name: string
  desc: string
  icon: string
}

const S = {
  card: { backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 } as React.CSSProperties,
  sectionLabel: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 14 },
}

function StatusBadge({ status }: { status: IntegrationCard['status'] }) {
  const cfg = {
    connected:     { label: 'Connected',         bg: 'rgba(74,207,154,0.12)',  color: '#4ACF9A' },
    not_connected: { label: 'Not Connected',     bg: 'rgba(239,68,68,0.10)',   color: '#ef4444' },
    coming_soon:   { label: 'Not yet available', bg: 'var(--c-hover)',         color: 'var(--c-text-2)' },
    loading:       { label: 'Checking…',         bg: 'var(--c-hover)',         color: 'var(--c-text-2)' },
  }[status]
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, backgroundColor: cfg.bg, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  )
}

export default function IntegrationsClient() {
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null)
  const [gmailEmail, setGmailEmail]         = useState<string>('')

  useEffect(() => {
    fetch('/api/auth/gmail/status').then(r => r.json()).then(d => {
      setGmailConnected(d.connected ?? false)
      setGmailEmail(d.email ?? '')
    }).catch(() => setGmailConnected(false))
  }, [])

  const integrations: IntegrationCard[] = [
    {
      id: 'gmail',
      name: 'Gmail',
      desc: 'Send and receive emails directly inside NextKey OS. Required for the Inbox module.',
      icon: '✉️',
      status: gmailConnected === null ? 'loading' : gmailConnected ? 'connected' : 'not_connected',
      detail: gmailConnected && gmailEmail ? `Connected as ${gmailEmail}` : undefined,
      actionLabel: gmailConnected === null ? undefined : gmailConnected ? 'Disconnect' : 'Connect Gmail',
      actionHref:  gmailConnected ? '/api/auth/gmail/disconnect' : '/api/auth/gmail',
    },
    {
      id: 'reapi',
      name: 'REAPI (Property Data)',
      desc: 'Pulls property records, owner history, and MLS data into Leads and Property Search.',
      icon: '🏠',
      status: 'connected',
      detail: 'Configured via environment — active',
    },
    {
      id: 'google-maps',
      name: 'Google Maps',
      desc: 'Powers map views on property cards and lead records.',
      icon: '🗺️',
      status: 'connected',
      detail: 'Configured via environment — active',
    },
    {
      id: 'twilio',
      name: 'Twilio (SMS)',
      desc: 'Send automated SMS follow-ups to leads and contacts.',
      icon: '📱',
      status: 'coming_soon',
    },
    {
      id: 'zapier',
      name: 'Zapier',
      desc: 'Connect NextKey OS to 5,000+ apps via automated workflows.',
      icon: '⚡',
      status: 'coming_soon',
    },
    {
      id: 'stripe',
      name: 'Stripe',
      desc: 'Collect earnest money deposits and transaction fees online.',
      icon: '💳',
      status: 'coming_soon',
    },
  ]

  const nativeCapabilities: NativeCapability[] = [
    {
      id: 'esign',
      name: 'Built-in E-Signatures',
      desc: 'Prepare, send, track, and complete signatures directly inside the platform. No external accounts or subscriptions required.',
      icon: '✍️',
      detail: 'Templates, merge fields, signer roles, signing sessions, and audit trail — included',
    },
  ]

  const externalEsignConnectors: ExternalConnector[] = [
    {
      id: 'docusign',
      name: 'DocuSign',
      desc: 'Optional connector for counterparties that require DocuSign specifically.',
      icon: '📝',
    },
    {
      id: 'dropbox-sign',
      name: 'Dropbox Sign',
      desc: 'Optional external e-signature connector.',
      icon: '📋',
    },
    {
      id: 'adobe-acrobat-sign',
      name: 'Adobe Acrobat Sign',
      desc: 'Optional external e-signature connector.',
      icon: '📄',
    },
  ]

  const handleGmailAction = (card: IntegrationCard) => {
    if (!card.actionHref) return
    if (card.id === 'gmail' && gmailConnected) {
      if (!confirm('Disconnect Gmail? This will stop email sending and receiving from NextKey OS.')) return
    }
    window.location.href = card.actionHref
  }

  const active  = integrations.filter(i => i.status === 'connected')
  const pending = integrations.filter(i => i.status === 'not_connected')
  const soon    = integrations.filter(i => i.status === 'coming_soon')

  const NativeCapabilityRow = ({ cap }: { cap: NativeCapability }) => (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(76,175,154,0.10)', border: '1px solid rgba(76,175,154,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
        {cap.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
          <p style={{ fontSize: 15, fontWeight: 700 }}>{cap.name}</p>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, backgroundColor: 'rgba(76,175,154,0.12)', color: '#4ACF9A', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
            Built-in
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--c-text-2)', lineHeight: 1.4 }}>{cap.desc}</p>
        {cap.detail && <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginTop: 4, fontStyle: 'italic' }}>{cap.detail}</p>}
      </div>
    </div>
  )

  const ExternalConnectorRow = ({ connector }: { connector: ExternalConnector }) => (
    <div style={{ ...S.card, marginBottom: 10, opacity: 0.65 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
        {connector.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
          <p style={{ fontSize: 15, fontWeight: 700 }}>{connector.name}</p>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', border: '1px solid var(--c-border)' }}>
            Not yet available
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--c-text-2)', lineHeight: 1.4 }}>{connector.desc}</p>
      </div>
    </div>
  )

  const CardRow = ({ card }: { card: IntegrationCard }) => (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
        {card.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
          <p style={{ fontSize: 15, fontWeight: 700 }}>{card.name}</p>
          <StatusBadge status={card.status} />
        </div>
        <p style={{ fontSize: 13, color: 'var(--c-text-2)', lineHeight: 1.4 }}>{card.desc}</p>
        {card.detail && <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginTop: 4, fontStyle: 'italic' }}>{card.detail}</p>}
      </div>
      {card.actionLabel && card.status !== 'coming_soon' && (
        <button
          onClick={() => handleGmailAction(card)}
          style={{
            padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            backgroundColor: card.status === 'connected' ? 'rgba(239,68,68,0.1)' : '#C9A84C',
            color: card.status === 'connected' ? '#ef4444' : '#0A1F44',
            border: card.status === 'connected' ? '1px solid rgba(239,68,68,0.2)' : 'none',
          }}
        >
          {card.actionLabel}
        </button>
      )}
    </div>
  )

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', color: 'var(--c-primary)' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Integrations</h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-2)' }}>Manage connected services, platform capabilities, and optional third-party connectors</p>
      </div>

      {active.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <p style={S.sectionLabel}>Active</p>
          {active.map(c => <CardRow key={c.id} card={c} />)}
        </section>
      )}

      {pending.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <p style={S.sectionLabel}>Not Connected</p>
          {pending.map(c => <CardRow key={c.id} card={c} />)}
        </section>
      )}

      {soon.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <p style={S.sectionLabel}>Coming Soon</p>
          {soon.map(c => <CardRow key={c.id} card={c} />)}
        </section>
      )}

      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Platform Capabilities</p>
        <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 14, lineHeight: 1.5 }}>
          Features built directly into the platform — no external accounts required.
        </p>
        {nativeCapabilities.map(c => <NativeCapabilityRow key={c.id} cap={c} />)}
      </section>

      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Optional External E-Sign Connectors</p>
        <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 14, lineHeight: 1.5 }}>
          NextKey&apos;s native e-signature engine is the default signing workflow. These external providers are optional and may be added if a counterparty specifically requires them.
        </p>
        {externalEsignConnectors.map(c => <ExternalConnectorRow key={c.id} connector={c} />)}
      </section>
    </div>
  )
}
