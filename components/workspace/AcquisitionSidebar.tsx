'use client'

import { useState } from 'react'
import { useWorkspace } from '@/app/leads/[id]/workspace-client'
import {
  STAGE_META,
  fmtMoney,
  type ProgressStep,
  type NextAction,
  type TabId,
} from '@/lib/acquisitionEngine'

// ── Stage quick-set ──────────────────────────────────────────────────────────

const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'reviewing',  label: 'Reviewing' },
  { value: 'contacted',  label: 'Contacted' },
  { value: 'offer',      label: 'Offer' },
  { value: 'dead',       label: 'Dead' },
  { value: 'blocked',    label: 'Blocked' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressDot({ status }: { status: 'done' | 'current' | 'future' }) {
  if (status === 'done') return (
    <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#0f2a18', border: '1.5px solid #22c55e', color: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>✓</div>
  )
  if (status === 'current') return (
    <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#1a3050', border: '1.5px solid #C9A84C', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#C9A84C' }} />
    </div>
  )
  return (
    <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#0a1729', border: '1.5px solid #1a3050', flexShrink: 0 }} />
  )
}

function ProgressLine({ done }: { done: boolean }) {
  return <div style={{ width: 1, height: 8, background: done ? '#22c55e44' : '#1a3050', margin: '-2px 0 -2px 7px' }} />
}

const ACTION_TYPE_ICON: Record<string, string> = {
  call:             '📞',
  sms:              '💬',
  email:            '✉️',
  create_offer:     '✦',
  sign_contract:    '✍️',
  create_deal:      '📊',
  add_contact:      '👤',
  generate_contract:'📄',
  analyze:          '🔍',
  navigate:         '→',
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function AcquisitionSidebar() {
  const { lead, acquisition, setActiveTab, updateLeadField } = useWorkspace()
  const { progress, nextActions, offerStatus, communicationStatus, documentStatus } = acquisition
  const [settingStage, setSettingStage] = useState(false)

  const handleNextAction = (action: NextAction) => {
    setActiveTab(action.tab as TabId)
  }

  const handleStageChange = async (value: string) => {
    setSettingStage(false)
    await updateLeadField({ pipeline_stage: value })
  }

  const currentStage = lead.pipeline_stage ?? ''
  const stageMeta    = STAGE_META[currentStage] ?? null

  return (
    <div style={{ borderLeft: '1px solid #1a3050', background: '#080f1c', overflowY: 'auto', display: 'flex', flexDirection: 'column', fontSize: 12 }}>

      {/* ── Acquisition Progress ── */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #1a3050' }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#4a6a9a', marginBottom: 10 }}>
          Acquisition Progress
        </div>

        {progress.map((step, i) => (
          <div key={step.phase}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
              <ProgressDot status={step.status} />
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 11, fontWeight: 500,
                  color: step.status === 'done' ? '#94a3b8' : step.status === 'current' ? '#C9A84C' : '#2a4060',
                }}>
                  {step.label}
                </div>
                {step.sublabel && (
                  <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 1 }}>{step.sublabel}</div>
                )}
              </div>
            </div>
            {i < progress.length - 1 && <ProgressLine done={step.status === 'done'} />}
          </div>
        ))}
      </div>

      {/* ── Next Actions ── */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #1a3050' }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#4a6a9a', marginBottom: 8 }}>
          Next Actions
        </div>

        {nextActions.length === 0 ? (
          <div style={{ fontSize: 11, color: '#4a6a9a', padding: '4px 0' }}>All caught up ✓</div>
        ) : nextActions.map((action, i) => (
          <button
            key={action.id}
            onClick={() => handleNextAction(action)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: '#0d1b2e', border: '1px solid #1a3050',
              borderRadius: 5, padding: '8px 9px', marginBottom: 5,
              cursor: 'pointer', transition: 'border-color .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#2a4060')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a3050')}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>
                {ACTION_TYPE_ICON[action.actionType] ?? '→'}
              </span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: '#e2e8f0', lineHeight: 1.3 }}>
                  {action.label}
                </div>
                {action.sublabel && (
                  <div style={{ fontSize: 10, color: '#4a6a9a', marginTop: 2 }}>{action.sublabel}</div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* ── Status summary ── */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #1a3050' }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#4a6a9a', marginBottom: 8 }}>
          Status
        </div>

        {/* Offer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
          <span style={{ color: '#4a6a9a', fontSize: 11 }}>Offer</span>
          <span style={{ fontSize: 11, fontWeight: 500, color: offerStatus.hasOffer ? '#C9A84C' : '#2a4060' }}>
            {offerStatus.hasOffer ? `$${fmtMoney(offerStatus.amount!)}` : '—'}
          </span>
        </div>

        {/* Call */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
          <span style={{ color: '#4a6a9a', fontSize: 11 }}>Call</span>
          <span style={{
            fontSize: 11, fontWeight: 500,
            color: communicationStatus.hasTalked ? '#22c55e' :
                   communicationStatus.callStatus !== 'not_called' ? '#60a5fa' : '#2a4060',
          }}>
            {communicationStatus.hasTalked ? 'Talked' :
             communicationStatus.callStatus === 'no_answer' ? 'No Answer' :
             communicationStatus.callStatus === 'voicemail' ? 'Voicemail' :
             communicationStatus.callStatus !== 'not_called' ? 'Called' : '—'}
          </span>
        </div>

        {/* Contract */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
          <span style={{ color: '#4a6a9a', fontSize: 11 }}>Contract</span>
          <span style={{
            fontSize: 11, fontWeight: 500,
            color: documentStatus.contractSigned ? '#22c55e' :
                   documentStatus.pendingSignature ? '#f59e0b' :
                   documentStatus.hasContract ? '#60a5fa' : '#2a4060',
          }}>
            {documentStatus.contractSigned ? 'Signed' :
             documentStatus.pendingSignature ? 'Pending' :
             documentStatus.hasContract ? 'Generated' : '—'}
          </span>
        </div>
      </div>

      {/* ── Stage setter ── */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#4a6a9a', marginBottom: 8 }}>
          Stage
        </div>

        {!settingStage ? (
          <button
            onClick={() => setSettingStage(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '6px 9px', borderRadius: 5,
              background: stageMeta?.bg ?? '#1f2937',
              border: `1px solid ${stageMeta?.color ?? '#374151'}44`,
              cursor: 'pointer', color: stageMeta?.color ?? '#6b7280',
              fontSize: 11, fontWeight: 500,
            }}
          >
            <span>● {stageMeta?.label ?? 'No Stage'}</span>
            <span style={{ fontSize: 10, color: '#4a6a9a' }}>change</span>
          </button>
        ) : (
          <div>
            {STAGE_OPTIONS.map(opt => {
              const meta = STAGE_META[opt.value]
              return (
                <button
                  key={opt.value}
                  onClick={() => handleStageChange(opt.value)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '5px 9px', borderRadius: 4, marginBottom: 3,
                    background: currentStage === opt.value ? (meta?.bg ?? '#1f2937') : '#0a1729',
                    border: `1px solid ${currentStage === opt.value ? (meta?.color ?? '#374151') + '44' : '#1a3050'}`,
                    color: meta?.color ?? '#6b7280', fontSize: 11, cursor: 'pointer',
                    fontWeight: currentStage === opt.value ? 600 : 400,
                  }}
                >
                  ● {opt.label}
                </button>
              )
            })}
            <button
              onClick={() => setSettingStage(false)}
              style={{ display: 'block', width: '100%', textAlign: 'center', padding: '4px', background: 'none', border: 'none', color: '#4a6a9a', fontSize: 10, cursor: 'pointer', marginTop: 2 }}
            >
              cancel
            </button>
          </div>
        )}
      </div>

    </div>
  )
}
