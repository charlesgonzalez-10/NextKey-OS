'use client'

interface ServiceEntry {
  name: string
  envVar: string
  desc: string
  icon: string
  configured: boolean
  note?: string
}

const S = {
  card: { backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 } as React.CSSProperties,
  sectionLabel: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--c-text-2)', marginBottom: 14 },
}

const SERVICES: ServiceEntry[] = [
  {
    name:       'Supabase',
    envVar:     'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
    desc:       'Database and authentication. Required for all platform operations.',
    icon:       '🗄️',
    configured: true,
    note:       'Service role key used server-side only — never exposed to the browser.',
  },
  {
    name:       'REAPI',
    envVar:     'REAPI_KEY',
    desc:       'Property data, owner lookups, and MLS records.',
    icon:       '🏠',
    configured: true,
    note:       'Backend only — no NEXT_PUBLIC prefix.',
  },
  {
    name:       'Google Maps',
    envVar:     'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
    desc:       'Map rendering on property and lead pages.',
    icon:       '🗺️',
    configured: true,
    note:       'Restricted to nextkeyos.vercel.app in Google Cloud Console.',
  },
  {
    name:       'Gmail OAuth',
    envVar:     'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / OAUTH_ENCRYPT_KEY',
    desc:       'Gmail connection for the Inbox module. Tokens encrypted at rest (AES-256-GCM).',
    icon:       '✉️',
    configured: true,
    note:       'OAUTH_ENCRYPT_KEY must never change after first use.',
  },
  {
    name:       'Twilio',
    envVar:     'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE',
    desc:       'SMS integration for automated lead follow-ups.',
    icon:       '📱',
    configured: false,
  },
  {
    name:       'Zapier Webhooks',
    envVar:     'ZAPIER_WEBHOOK_URL',
    desc:       'Trigger Zapier workflows from NextKey OS events.',
    icon:       '⚡',
    configured: false,
  },
  {
    name:       'DocuSign',
    envVar:     'DOCUSIGN_INTEGRATION_KEY / DOCUSIGN_ACCOUNT_ID',
    desc:       'E-signature for contracts and offers.',
    icon:       '📝',
    configured: false,
  },
]

function MaskedKey({ configured }: { configured: boolean }) {
  if (!configured) return <span style={{ fontSize: 13, color: 'var(--c-text-2)', fontStyle: 'italic' }}>Not configured</span>
  return (
    <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--c-text-2)', backgroundColor: 'var(--c-hover)', padding: '2px 8px', borderRadius: 5, letterSpacing: '0.1em' }}>
      ••••••••••••••••
    </span>
  )
}

export default function ApiKeysClient() {
  const configured = SERVICES.filter(s => s.configured)
  const missing    = SERVICES.filter(s => !s.configured)

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', color: 'var(--c-primary)' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>API Keys</h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-2)' }}>Configured services and credentials — owner view only</p>
      </div>

      <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 24, fontSize: 13, backgroundColor: 'rgba(201,168,76,0.08)', color: 'var(--c-primary)', border: '1px solid rgba(201,168,76,0.2)' }}>
        <strong>Security note:</strong> API keys are stored in environment variables and are never displayed in plain text. To add or rotate a key, update your <code style={{ fontFamily: 'monospace', backgroundColor: 'var(--c-hover)', padding: '1px 6px', borderRadius: 4 }}>.env.local</code> file and redeploy on Vercel.
      </div>

      <section style={{ marginBottom: 28 }}>
        <p style={S.sectionLabel}>Configured ({configured.length})</p>
        {configured.map(svc => (
          <div key={svc.envVar} style={S.card}>
            <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(74,207,154,0.1)', border: '1px solid rgba(74,207,154,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
              {svc.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <p style={{ fontSize: 15, fontWeight: 700 }}>{svc.name}</p>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, backgroundColor: 'rgba(74,207,154,0.12)', color: '#4ACF9A', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Active</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 6, lineHeight: 1.4 }}>{svc.desc}</p>
              <MaskedKey configured={svc.configured} />
              {svc.note && <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginTop: 4, fontStyle: 'italic' }}>{svc.note}</p>}
              <p style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--c-text-2)', marginTop: 6, opacity: 0.7 }}>{svc.envVar}</p>
            </div>
          </div>
        ))}
      </section>

      {missing.length > 0 && (
        <section>
          <p style={S.sectionLabel}>Not Configured ({missing.length})</p>
          {missing.map(svc => (
            <div key={svc.envVar} style={{ ...S.card, opacity: 0.7 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'var(--c-hover)', border: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                {svc.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{svc.name}</p>
                <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 6, lineHeight: 1.4 }}>{svc.desc}</p>
                <MaskedKey configured={false} />
                <p style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--c-text-2)', marginTop: 6, opacity: 0.7 }}>{svc.envVar}</p>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
