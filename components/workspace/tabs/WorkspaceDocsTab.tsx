'use client'

import { useState } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import { fmtDateTime } from '@/lib/acquisitionEngine'

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 7, padding: '12px 14px', ...style }}>{children}</div>
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#4a6a9a', marginBottom: 9 }}>{children}</div>
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_signature: { label: 'Awaiting Signature', color: '#f59e0b', bg: '#3d2800' },
  sent:              { label: 'Sent',                color: '#60a5fa', bg: '#1e3a5f' },
  signed:            { label: 'Signed',              color: '#22c55e', bg: '#0f2a18' },
  executed:          { label: 'Executed',            color: '#22c55e', bg: '#0f2a18' },
  completed:         { label: 'Completed',           color: '#22c55e', bg: '#0f2a18' },
  draft:             { label: 'Draft',               color: '#6b7280', bg: '#1f2937' },
  voided:            { label: 'Voided',              color: '#6b7280', bg: '#1f2937' },
}

export default function WorkspaceDocsTab() {
  const { lead, documents, acquisition, setActiveTab, refreshDocuments } = useWorkspace()
  const { documentStatus } = acquisition
  const [showGenerate, setShowGenerate] = useState(false)

  const propertyId = lead.id

  // Group docs by category
  const contracts = documents.filter(d =>
    d.category === 'contract' ||
    d.name?.toLowerCase().includes('contract') ||
    d.name?.toLowerCase().includes('far/bar') ||
    d.name?.toLowerCase().includes('purchase')
  )
  const other = documents.filter(d => !contracts.includes(d))

  const openDocument = async (docId: string) => {
    window.open(`/documents/${docId}`, '_blank')
  }

  const sendForSignature = async (docId: string) => {
    window.location.href = `/sign-sessions/new?document_id=${docId}`
  }

  return (
    <div>

      {/* ── Action bar ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          onClick={() => setActiveTab('offer')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 5, background: '#C9A84C', border: 'none', color: '#060e1a', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          ✦ Generate Contract
        </button>
        <button
          style={{ padding: '7px 12px', borderRadius: 5, border: '1px solid #1a3050', background: '#0d1b2e', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}
        >
          ↑ Upload Document
        </button>
      </div>

      {/* ── Contracts ── */}
      <Card style={{ marginBottom: 14 }}>
        <CardTitle>Contracts &amp; Agreements</CardTitle>

        {!documentStatus.hasContract && (
          <div style={{ padding: '12px 0', textAlign: 'center' as const }}>
            <p style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 10 }}>
              No contracts generated yet.
              {!acquisition.offerStatus.hasOffer && ' Make an offer first, then generate the contract.'}
            </p>
            {acquisition.offerStatus.hasOffer && (
              <button
                onClick={() => setActiveTab('offer')}
                style={{ padding: '6px 14px', borderRadius: 5, background: '#1a3050', border: '1px solid #C9A84C44', color: '#C9A84C', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                Go to Offer → Generate Contract
              </button>
            )}
          </div>
        )}

        {contracts.map(doc => {
          const meta = STATUS_META[doc.status?.toLowerCase() ?? ''] ?? { label: doc.status ?? 'Unknown', color: '#6b7280', bg: '#1f2937' }
          return (
            <div
              key={doc.id}
              style={{ background: '#0a1729', border: '1px solid #1a3050', borderRadius: 6, padding: '10px 12px', marginBottom: 8 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.name}
                  </div>
                  <div style={{ fontSize: 10, color: '#4a6a9a' }}>
                    {fmtDateTime(doc.created_at)}
                    {doc.recipient_name && ` · ${doc.recipient_name}`}
                  </div>
                </div>
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, background: meta.bg, color: meta.color, fontSize: 10, fontWeight: 500, flexShrink: 0 }}>
                  {meta.label}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {doc.pdf_path && (
                  <button
                    onClick={() => openDocument(doc.id)}
                    style={{ padding: '4px 9px', borderRadius: 4, border: '1px solid #1a3050', background: '#0d1b2e', color: '#94a3b8', fontSize: 10, cursor: 'pointer' }}
                  >
                    View
                  </button>
                )}
                {!['signed', 'executed', 'completed', 'voided'].includes(doc.status?.toLowerCase() ?? '') && (
                  <button
                    onClick={() => sendForSignature(doc.id)}
                    style={{ padding: '4px 9px', borderRadius: 4, background: '#C9A84C', border: 'none', color: '#060e1a', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Send for Signature →
                  </button>
                )}
                {doc.signed_pdf_path && (
                  <button
                    onClick={() => openDocument(doc.id)}
                    style={{ padding: '4px 9px', borderRadius: 4, border: '1px solid #22c55e44', background: '#0f2a18', color: '#22c55e', fontSize: 10, cursor: 'pointer' }}
                  >
                    ✓ Download Signed
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </Card>

      {/* ── Other documents ── */}
      {other.length > 0 && (
        <Card>
          <CardTitle>Other Documents</CardTitle>
          {other.map(doc => {
            const meta = STATUS_META[doc.status?.toLowerCase() ?? ''] ?? { label: doc.status ?? 'Unknown', color: '#6b7280', bg: '#1f2937' }
            return (
              <div
                key={doc.id}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #0d1b2e', gap: 10 }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                  <div style={{ fontSize: 10, color: '#4a6a9a' }}>{fmtDateTime(doc.created_at)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{ padding: '2px 7px', borderRadius: 20, background: meta.bg, color: meta.color, fontSize: 10 }}>{meta.label}</span>
                  {doc.pdf_path && (
                    <button
                      onClick={() => openDocument(doc.id)}
                      style={{ padding: '3px 7px', borderRadius: 4, border: '1px solid #1a3050', background: '#0d1b2e', color: '#94a3b8', fontSize: 10, cursor: 'pointer' }}
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </Card>
      )}

      {documents.length === 0 && (
        <div style={{ textAlign: 'center' as const, padding: '32px 0', color: '#4a6a9a', fontSize: 12 }}>
          No documents yet. Generate a contract from the Offer tab.
        </div>
      )}

    </div>
  )
}
