'use client'

import { useState, useMemo } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import { fmtMoneyFull, offerPctCalc } from '@/lib/acquisitionEngine'

const OFFER_PCTS = [50, 55, 60, 65, 70, 75]

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

type BaseValueType = 'market' | 'arv' | 'custom'

export default function OfferTab() {
  const { lead, acquisition, updateLeadField, setActiveTab } = useWorkspace()
  const { offerStatus } = acquisition

  // Which base value to use
  const [baseType, setBaseType]   = useState<BaseValueType>('market')
  const [customBase, setCustomBase] = useState('')
  const [selectedPct, setSelectedPct] = useState<number>(lead.offer_pct ?? 65)
  const [customPct,   setCustomPct]   = useState('')
  const [earnest,     setEarnest]     = useState('1000')
  const [inspection,  setInspection]  = useState('10')
  const [closingDays, setClosingDays] = useState('30')
  const [financing,   setFinancing]   = useState('Cash')
  const [showRevise,  setShowRevise]  = useState(!offerStatus.hasOffer)
  const [saving,      setSaving]      = useState(false)
  const [sendingSoon, setSendingSoon] = useState(false)

  const mv = lead.estimated_value ?? 0

  const baseValue = useMemo(() => {
    if (baseType === 'market')  return mv
    if (baseType === 'custom')  return parseFloat(customBase.replace(/[^0-9.]/g, '')) || 0
    return 0
  }, [baseType, mv, customBase])

  const effectivePct = customPct ? parseFloat(customPct) || selectedPct : selectedPct
  const calculatedOffer = baseValue > 0 ? offerPctCalc(baseValue, effectivePct) : 0

  const handleSaveOffer = async () => {
    if (calculatedOffer <= 0) return
    setSaving(true)
    await updateLeadField({
      offer_amount:   calculatedOffer,
      offer_pct:      effectivePct,
      pipeline_stage: 'offer',
    })
    setSaving(false)
    setShowRevise(false)
  }

  const handleMarkSent = async () => {
    setSendingSoon(true)
    await updateLeadField({ offer_sent: true })
    setSendingSoon(false)
  }

  return (
    <div>

      {/* ── Current offer status bar ── */}
      {offerStatus.hasOffer && !showRevise && (
        <div style={{ background: '#0f2800', border: '1px solid #5c3a0044', borderRadius: 7, padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#C9A84C', lineHeight: 1 }}>
              {fmtMoneyFull(offerStatus.amount!)}
            </div>
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 3 }}>
              {offerStatus.pct}% of {baseType === 'market' ? 'market value' : 'base'} · {financing}
            </div>
            <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 2 }}>
              {offerStatus.sent ? '● Sent to seller · Awaiting response' : '○ Not sent yet'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {!offerStatus.sent && (
              <button
                onClick={handleMarkSent}
                disabled={sendingSoon}
                style={{ padding: '6px 12px', borderRadius: 5, background: '#C9A84C', border: 'none', color: '#060e1a', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: sendingSoon ? 0.7 : 1 }}
              >
                {sendingSoon ? 'Saving…' : 'Mark as Sent'}
              </button>
            )}
            <button
              onClick={() => setActiveTab('documents')}
              style={{ padding: '6px 12px', borderRadius: 5, border: '1px solid #1a3050', background: '#0d1b2e', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}
            >
              📄 Generate Contract
            </button>
            <button
              onClick={() => { setShowRevise(true); setSelectedPct(lead.offer_pct ?? 65) }}
              style={{ padding: '6px 12px', borderRadius: 5, border: '1px solid #1a3050', background: '#0d1b2e', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}
            >
              Revise Offer
            </button>
          </div>
        </div>
      )}

      {/* ── Offer builder / revise form ── */}
      {(showRevise || !offerStatus.hasOffer) && (
        <Card style={{ marginBottom: 14 }}>
          <CardTitle>{offerStatus.hasOffer ? 'Revise Offer' : 'Build an Offer'}</CardTitle>

          {/* Step 1: Base Value */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 6, fontWeight: 600 }}>1 — Choose base value</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {([
                { type: 'market' as BaseValueType, label: 'Market Value', value: mv > 0 ? fmtMoneyFull(mv) : '—', available: mv > 0 },
                { type: 'arv'    as BaseValueType, label: 'ARV (After Repair Value)', value: '— enter in Analyze tab', available: false },
                { type: 'custom' as BaseValueType, label: 'Custom value', value: null, available: true },
              ]).map(opt => (
                <button
                  key={opt.type}
                  onClick={() => opt.available && setBaseType(opt.type)}
                  disabled={!opt.available}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '9px 11px', borderRadius: 6,
                    border: `1.5px solid ${baseType === opt.type ? '#C9A84C' : '#1a3050'}`,
                    background: baseType === opt.type ? '#1a1500' : '#0a1729',
                    cursor: opt.available ? 'pointer' : 'default',
                    opacity: opt.available ? 1 : 0.45,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 500, color: baseType === opt.type ? '#C9A84C' : '#94a3b8' }}>
                    {opt.label}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: baseType === opt.type ? '#C9A84C' : '#e2e8f0' }}>
                    {opt.type === 'custom' ? (
                      <input
                        value={customBase}
                        onChange={e => setCustomBase(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="$"
                        style={{ width: 90, background: '#060e1a', border: '1px solid #1a3050', borderRadius: 4, padding: '3px 6px', color: '#e2e8f0', fontSize: 11, fontFamily: 'inherit' }}
                      />
                    ) : opt.value}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Offer % */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 6, fontWeight: 600 }}>
              2 — Choose offer % {baseValue > 0 && <span style={{ color: '#C9A84C', marginLeft: 4 }}>of {fmtMoneyFull(baseValue)}</span>}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
              {OFFER_PCTS.map(pct => {
                const amt = baseValue > 0 ? offerPctCalc(baseValue, pct) : null
                return (
                  <button
                    key={pct}
                    onClick={() => { setSelectedPct(pct); setCustomPct('') }}
                    style={{
                      padding: '5px 10px', borderRadius: 20,
                      border: `1.5px solid ${selectedPct === pct && !customPct ? '#C9A84C' : '#1a3050'}`,
                      background: selectedPct === pct && !customPct ? '#1a1500' : '#0a1729',
                      color: selectedPct === pct && !customPct ? '#C9A84C' : '#4a6a9a',
                      fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {pct}%{amt ? ` · $${Math.round(amt / 1000)}k` : ''}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Live calculation */}
          {calculatedOffer > 0 && (
            <div style={{ background: '#060e1a', borderRadius: 5, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#4a6a9a', marginBottom: 3 }}>
                <span>{fmtMoneyFull(baseValue)} × {effectivePct}%</span>
                <span>= {fmtMoneyFull(calculatedOffer)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700 }}>
                <span style={{ color: '#e2e8f0' }}>Offer Price</span>
                <span style={{ color: '#C9A84C' }}>{fmtMoneyFull(calculatedOffer)}</span>
              </div>
            </div>
          )}

          {/* Step 3: Terms */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 6, fontWeight: 600 }}>3 — Offer terms</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'Financing',        value: financing,   setter: setFinancing,   type: 'select', opts: ['Cash', 'Conventional', 'Hard Money', 'Subject-To'] },
                { label: 'Earnest Money ($)', value: earnest,     setter: setEarnest,     type: 'input' },
                { label: 'Inspection (days)', value: inspection,  setter: setInspection,  type: 'input' },
                { label: 'Closing (days)',    value: closingDays, setter: setClosingDays, type: 'input' },
              ].map(f => (
                <div key={f.label}>
                  <div style={{ fontSize: 10, color: '#4a6a9a', marginBottom: 2 }}>{f.label}</div>
                  {f.type === 'select' ? (
                    <select
                      value={f.value}
                      onChange={e => f.setter(e.target.value)}
                      style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 4, padding: '5px 7px', color: '#e2e8f0', fontSize: 11 }}
                    >
                      {f.opts!.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      value={f.value}
                      onChange={e => f.setter(e.target.value)}
                      style={{ width: '100%', background: '#060e1a', border: '1px solid #1a3050', borderRadius: 4, padding: '5px 7px', color: '#e2e8f0', fontSize: 11, fontFamily: 'inherit' }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 7 }}>
            <button
              onClick={handleSaveOffer}
              disabled={saving || calculatedOffer <= 0}
              style={{ flex: 1, padding: '8px', borderRadius: 5, background: '#C9A84C', border: 'none', color: '#060e1a', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: saving || calculatedOffer <= 0 ? 0.5 : 1 }}
            >
              {saving ? 'Saving…' : offerStatus.hasOffer ? 'Update Offer' : 'Save Offer'}
            </button>
            {offerStatus.hasOffer && (
              <button
                onClick={() => setShowRevise(false)}
                style={{ padding: '8px 14px', borderRadius: 5, border: '1px solid #1a3050', background: '#0a1729', color: '#4a6a9a', fontSize: 11, cursor: 'pointer' }}
              >
                Cancel
              </button>
            )}
          </div>
        </Card>
      )}

      {/* ── Offer terms summary ── */}
      {offerStatus.hasOffer && !showRevise && (
        <Card style={{ marginBottom: 14 }}>
          <CardTitle>Current Offer Terms</CardTitle>
          <KV k="Offer Price"       v={fmtMoneyFull(offerStatus.amount!)} vColor="#C9A84C" />
          <KV k="Offer %"           v={`${offerStatus.pct ?? '—'}%`} />
          <KV k="Financing"         v={financing} />
          <KV k="Earnest Money"     v={`$${parseInt(earnest).toLocaleString()}`} />
          <KV k="Inspection Period" v={`${inspection} days`} />
          <KV k="Closing"           v={`${closingDays} days from acceptance`} />
          <KV k="Buyer"             v="You (account default)" />
          <div style={{ borderTop: '1px solid #1a3050', margin: '8px 0' }} />
          <div style={{ display: 'flex', gap: 7 }}>
            <button
              onClick={() => setActiveTab('documents')}
              style={{ flex: 1, padding: '6px', borderRadius: 5, border: '1px solid #1a3050', background: '#0d1b2e', color: '#94a3b8', fontSize: 11, cursor: 'pointer', textAlign: 'center' as const }}
            >
              📄 Generate Contract
            </button>
            <button
              onClick={() => setActiveTab('comms')}
              style={{ flex: 1, padding: '6px', borderRadius: 5, border: '1px solid #1a3050', background: '#0d1b2e', color: '#94a3b8', fontSize: 11, cursor: 'pointer', textAlign: 'center' as const }}
            >
              ✉️ Email to Seller
            </button>
          </div>
        </Card>
      )}

      {/* ── History ── */}
      <Card>
        <CardTitle>Offer History</CardTitle>
        {!offerStatus.hasOffer ? (
          <p style={{ fontSize: 11, color: '#4a6a9a' }}>No offers made yet.</p>
        ) : (
          <div style={{ background: '#060e1a', borderRadius: 5, padding: '8px 10px', fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#e2e8f0' }}>{fmtMoneyFull(offerStatus.amount!)} &nbsp;<span style={{ color: '#4a6a9a' }}>· {offerStatus.pct}%</span></span>
            <span style={{ color: offerStatus.sent ? '#f59e0b' : '#4a6a9a', fontSize: 10 }}>
              {offerStatus.sent ? 'Sent · Pending' : 'Not sent yet'}
            </span>
          </div>
        )}
      </Card>

    </div>
  )
}
