'use client'

import { useState } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import { fmtMoneyFull, fmtDate } from '@/lib/acquisitionEngine'

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: '#0d1b2e', border: '1px solid #1a3050', borderRadius: 7, padding: '12px 14px', ...style }}>{children}</div>
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#4a6a9a', marginBottom: 9 }}>{children}</div>
}

function KV({ k, v, vColor }: { k: string; v: React.ReactNode; vColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
      <span style={{ color: '#4a6a9a', fontSize: 11 }}>{k}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: vColor ?? '#e2e8f0', textAlign: 'right' }}>{v}</span>
    </div>
  )
}

interface ChecklistItem {
  id: string
  label: string
  sublabel?: string
  status: 'done' | 'active' | 'future'
  tab?: string
}

export default function CloseTab() {
  const { lead, deals, documents, acquisition, setActiveTab, aiSummary } = useWorkspace()
  const { offerStatus, documentStatus, dealStatus, communicationStatus } = acquisition

  const [creatingDeal, setCreatingDeal] = useState(false)
  const [dealError,    setDealError]    = useState('')

  const propertyId = lead.id

  const handleCreateDeal = async () => {
    setCreatingDeal(true)
    setDealError('')
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: `${lead.property_address}, ${lead.city ?? ''}, ${lead.state ?? ''} ${lead.zip ?? ''}`.trim(),
          offer_price: lead.offer_amount,
          status: 'Active',
          property_id: propertyId,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to create deal')
      }
      window.location.reload()
    } catch (err: unknown) {
      setDealError(err instanceof Error ? err.message : 'Error')
      setCreatingDeal(false)
    }
  }

  // Build dynamic checklist
  const checklist: ChecklistItem[] = [
    {
      id: 'lead',
      label: 'Lead qualified',
      sublabel: lead.lead_score != null ? `Score ${lead.lead_score}/100` : undefined,
      status: 'done',
    },
    {
      id: 'analyzed',
      label: 'Property analyzed',
      sublabel: aiSummary ? 'AI analysis complete' : undefined,
      status: aiSummary || lead.lead_score ? 'done' : 'active',
      tab: 'analyze',
    },
    {
      id: 'contacted',
      label: 'Owner contacted',
      sublabel: communicationStatus.hasTalked ? 'Talked with owner' : communicationStatus.hasAnyContact ? 'Attempted contact' : undefined,
      status: communicationStatus.hasAnyContact ? 'done' : 'active',
      tab: 'comms',
    },
    {
      id: 'offer',
      label: 'Offer made',
      sublabel: offerStatus.hasOffer ? fmtMoneyFull(offerStatus.amount!) : undefined,
      status: offerStatus.hasOffer ? 'done' : communicationStatus.hasAnyContact ? 'active' : 'future',
      tab: 'offer',
    },
    {
      id: 'offer_sent',
      label: 'Offer sent to seller',
      sublabel: offerStatus.sent ? 'Sent · Awaiting response' : undefined,
      status: offerStatus.sent ? 'done' : offerStatus.hasOffer ? 'active' : 'future',
      tab: 'offer',
    },
    {
      id: 'contract',
      label: 'Contract generated',
      sublabel: documentStatus.hasContract ? documentStatus.contractDoc?.name : undefined,
      status: documentStatus.hasContract ? 'done' : offerStatus.sent ? 'active' : 'future',
      tab: 'documents',
    },
    {
      id: 'signed',
      label: 'Contract signed',
      sublabel: documentStatus.contractSigned ? 'Executed ✓' : documentStatus.pendingSignature ? 'Awaiting signature' : undefined,
      status: documentStatus.contractSigned ? 'done' : documentStatus.hasContract ? 'active' : 'future',
      tab: 'documents',
    },
    {
      id: 'deal',
      label: 'Deal opened',
      sublabel: dealStatus.hasDeal ? `Status: ${dealStatus.dealStatus}` : undefined,
      status: dealStatus.hasDeal ? 'done' : documentStatus.contractSigned ? 'active' : 'future',
    },
    {
      id: 'inspection',
      label: 'Inspection completed',
      status: 'future',
    },
    {
      id: 'closing',
      label: 'Closing scheduled',
      status: 'future',
    },
    {
      id: 'closed',
      label: 'Closed ✦',
      status: 'future',
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

      {/* ── Left: Acquisition checklist ── */}
      <div>
        <Card>
          <CardTitle>Acquisition Checklist</CardTitle>
          {checklist.map(item => (
            <div
              key={item.id}
              onClick={item.tab ? () => setActiveTab(item.tab as any) : undefined}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #0d1b2e', cursor: item.tab ? 'pointer' : 'default' }}
            >
              {/* Checkbox */}
              <div style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9,
                background: item.status === 'done' ? '#0f2a18' : '#0a1729',
                border: `1.5px solid ${item.status === 'done' ? '#22c55e' : item.status === 'active' ? '#C9A84C' : '#1a3050'}`,
                color: item.status === 'done' ? '#22c55e' : 'transparent',
              }}>
                {item.status === 'done' ? '✓' : ''}
              </div>
              {/* Label */}
              <div>
                <div style={{
                  fontSize: 11, fontWeight: 500,
                  color: item.status === 'done' ? '#4a6a9a' : item.status === 'active' ? '#C9A84C' : '#2a4060',
                }}>
                  {item.label}
                  {item.tab && item.status !== 'done' && (
                    <span style={{ fontSize: 10, color: '#4a6a9a', marginLeft: 4 }}>→</span>
                  )}
                </div>
                {item.sublabel && (
                  <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 1 }}>{item.sublabel}</div>
                )}
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* ── Right: Deal + title ── */}
      <div>
        {/* Deal */}
        <Card style={{ marginBottom: 12 }}>
          <CardTitle>Deal</CardTitle>
          {dealStatus.hasDeal ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#C9A84C', marginBottom: 6 }}>
                {lead.property_address}
              </div>
              <KV k="Status"      v={dealStatus.dealStatus ?? '—'} />
              {lead.offer_amount && <KV k="Offer Price"  v={fmtMoneyFull(lead.offer_amount)} vColor="#C9A84C" />}
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={() => window.location.href = `/deals/${dealStatus.dealId}`}
                  style={{ width: '100%', padding: '6px', borderRadius: 5, border: '1px solid #C9A84C44', background: '#1a3050', color: '#C9A84C', fontSize: 11, fontWeight: 600, cursor: 'pointer', textAlign: 'center' as const }}
                >
                  Open Deal →
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 8 }}>
                {documentStatus.contractSigned
                  ? 'Contract signed — ready to open a deal.'
                  : 'Open a deal once the seller accepts your offer.'}
              </p>
              {dealError && <p style={{ fontSize: 10, color: '#ef4444', marginBottom: 6 }}>{dealError}</p>}
              <button
                onClick={handleCreateDeal}
                disabled={creatingDeal}
                style={{ width: '100%', padding: '7px', borderRadius: 5, border: '1px solid #1a3050', background: '#0a1729', color: '#94a3b8', fontSize: 11, cursor: 'pointer', opacity: creatingDeal ? 0.6 : 1 }}
              >
                {creatingDeal ? 'Creating…' : '+ Open Deal'}
              </button>
            </div>
          )}
        </Card>

        {/* Title company */}
        <Card style={{ marginBottom: 12 }}>
          <CardTitle>Title Company</CardTitle>
          <p style={{ fontSize: 11, color: '#4a6a9a', marginBottom: 8 }}>
            Not assigned. You can set a default in Contract Settings.
          </p>
          <button
            onClick={() => window.location.href = '/settings/contract-defaults'}
            style={{ width: '100%', padding: '6px', borderRadius: 5, border: '1px solid #1a3050', background: '#0a1729', color: '#4a6a9a', fontSize: 11, cursor: 'pointer', textAlign: 'center' as const }}
          >
            Manage Title Companies →
          </button>
        </Card>

        {/* AI closing insight */}
        {aiSummary && (
          <Card style={{ borderColor: '#1a5c2a22' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#0f1e0a', border: '1px solid #1a5c2a', color: '#4ade80', marginBottom: 8 }}>
              ✦ AI Closing Insight
            </div>
            {aiSummary.urgency && (
              <p style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
                Urgency: <strong style={{ color: '#e2e8f0' }}>{aiSummary.urgency}</strong>
              </p>
            )}
            {aiSummary.strategy && (
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
                Strategy: <strong style={{ color: '#e2e8f0' }}>{aiSummary.strategy}</strong>
              </p>
            )}
          </Card>
        )}
      </div>

    </div>
  )
}
