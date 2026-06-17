'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Session {
  id: string
  title: string
  status: string
  signers: { id: string; name: string; email: string; color: string; role?: string }[]
  fields: unknown[]
  created_at: string
  completed_at: string | null
  signer_statuses: { signer_ref_id: string; status: string }[]
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  draft:       { bg: 'rgba(107,114,128,0.12)', color: '#6b7280' },
  sent:        { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  in_progress: { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
  completed:   { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e' },
  voided:      { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
}

const SIGNER_COLORS = ['#4CAF9A', '#7B8FD4', '#E07B6A', '#C9A84C', '#6ABDE0', '#B06AE0']

export default function SignSessionsClient() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/signing-sessions')
      .then(r => r.json())
      .then(d => { setSessions(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="p-4 md:p-8" style={{ color: 'var(--c-primary)' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--c-primary)' }}>E-Signatures</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--c-text-2)' }}>
            {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/sign-sessions/new"
          className="flex items-center gap-2 font-bold px-4 py-2.5 rounded-xl hover:opacity-90 transition-opacity text-sm"
          style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Signing Session
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-16" style={{ color: 'var(--c-text-3)' }}>Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl p-16 text-center"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <div className="text-4xl mb-4">✍️</div>
          <p className="font-semibold mb-1" style={{ color: 'var(--c-primary)' }}>No signing sessions yet</p>
          <p className="text-sm mb-4" style={{ color: 'var(--c-text-2)' }}>
            Upload a blank contract, place signature fields, and send to signers.
          </p>
          <Link href="/sign-sessions/new"
            className="inline-block px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
            Create First Session
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => {
            const st = STATUS_COLORS[s.status] ?? STATUS_COLORS.draft
            const totalSigners = s.signers?.length ?? 0
            const signedCount = s.signer_statuses.filter(r => r.status === 'signed').length

            return (
              <Link key={s.id} href={`/sign-sessions/${s.id}`}
                className="block rounded-2xl p-5 hover:opacity-90 transition-opacity"
                style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm truncate" style={{ color: 'var(--c-primary)' }}>{s.title}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0"
                        style={{ backgroundColor: st.bg, color: st.color }}>
                        {s.status.replace('_', ' ').toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs mb-3" style={{ color: 'var(--c-text-2)' }}>
                      {(s.fields as unknown[])?.length ?? 0} fields · {new Date(s.created_at).toLocaleDateString()}
                    </p>

                    {/* Signers */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {(s.signers ?? []).map((signer, idx) => {
                        const signerStatus = s.signer_statuses.find(r => r.signer_ref_id === signer.id)?.status ?? 'pending'
                        const color = signer.color ?? SIGNER_COLORS[idx % SIGNER_COLORS.length]
                        return (
                          <div key={signer.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                            style={{ backgroundColor: `${color}18`, border: `1px solid ${color}40` }}>
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-[11px] font-semibold" style={{ color }}>
                              {signer.name}{signer.role ? ` · ${signer.role}` : ''}
                            </span>
                            <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                              {signerStatus === 'signed' ? '✓' : signerStatus === 'viewed' ? '👁' : '⏳'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {totalSigners > 0 && (
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold" style={{ color: 'var(--c-text-2)' }}>
                        {signedCount}/{totalSigners} signed
                      </p>
                      <div className="mt-1 w-20 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--c-border)' }}>
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${totalSigners > 0 ? (signedCount / totalSigners) * 100 : 0}%`, backgroundColor: '#22c55e' }} />
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
