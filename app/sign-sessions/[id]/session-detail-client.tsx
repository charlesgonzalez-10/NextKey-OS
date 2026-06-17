'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface SignerRow {
  id: string
  signer_ref_id: string
  name: string
  email: string
  role: string | null
  color: string
  status: string
  token: string
  viewed_at: string | null
  signed_at: string | null
  declined_at: string | null
  decline_reason: string | null
}

interface Session {
  id: string
  title: string
  status: string
  signers: { id: string; name: string; email: string; role?: string; color: string }[]
  fields: { id: string; type: string; page: number; signer_id: string }[]
  created_at: string
  completed_at: string | null
  pdf_url: string | null
  completed_pdf_path: string | null
  signer_rows: SignerRow[]
}

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  draft:       { bg: 'rgba(107,114,128,0.12)', color: '#6b7280', label: 'Draft' },
  sent:        { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6', label: 'Sent' },
  in_progress: { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', label: 'In Progress' },
  completed:   { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e', label: 'Completed' },
  voided:      { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444', label: 'Voided' },
}

const SIGNER_STATUS_LABELS: Record<string, { icon: string; label: string; color: string }> = {
  pending:  { icon: '⏳', label: 'Awaiting',  color: '#6b7280' },
  viewed:   { icon: '👁',  label: 'Viewed',    color: '#f59e0b' },
  signed:   { icon: '✓',  label: 'Signed',    color: '#22c55e' },
  declined: { icon: '✕',  label: 'Declined',  color: '#ef4444' },
}

export default function SessionDetailClient({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  useEffect(() => {
    fetch(`/api/signing-sessions/${sessionId}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? 'Not found')
        return r.json()
      })
      .then(setSession)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [sessionId])

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/sign/${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(token)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const handleDelete = async () => {
    setDeleting(true)
    const res = await fetch(`/api/signing-sessions/${sessionId}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/sign-sessions')
    } else {
      setDeleting(false)
      setShowDeleteConfirm(false)
      setError('Failed to delete session')
    }
  }

  const downloadSignedPdf = async () => {
    if (!session?.completed_pdf_path) return
    setDownloadingPdf(true)
    try {
      const res = await fetch(`/api/signing-sessions/${sessionId}/download`)
      if (!res.ok) throw new Error('Failed to get download link')
      const { url } = await res.json()
      const a = document.createElement('a')
      a.href = url
      a.download = `${session.title}_signed.pdf`
      a.click()
    } catch {
      setError('Could not download PDF')
    } finally {
      setDownloadingPdf(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="space-y-3 animate-pulse">
          <div className="h-8 w-64 rounded-lg" style={{ backgroundColor: 'var(--c-border)' }} />
          <div className="h-4 w-40 rounded" style={{ backgroundColor: 'var(--c-border)' }} />
          <div className="h-48 rounded-xl mt-6" style={{ backgroundColor: 'var(--c-border)' }} />
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="p-8">
        <Link href="/sign-sessions" className="text-sm mb-4 inline-flex items-center gap-1"
          style={{ color: 'var(--c-text-2)' }}>
          ← Back to sessions
        </Link>
        <div className="rounded-2xl p-12 text-center mt-4"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <p className="font-semibold" style={{ color: 'var(--c-primary)' }}>Session not found</p>
          <p className="text-sm mt-1" style={{ color: 'var(--c-text-2)' }}>{error ?? 'This session may have been deleted.'}</p>
          <Link href="/sign-sessions" className="inline-block mt-4 px-4 py-2 rounded-xl text-sm font-bold"
            style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}>
            Back to Sessions
          </Link>
        </div>
      </div>
    )
  }

  const st = STATUS_COLORS[session.status] ?? STATUS_COLORS.draft
  const totalFields = session.fields?.length ?? 0
  const isCompleted = session.status === 'completed'
  const isVoided = session.status === 'voided'

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto" style={{ color: 'var(--c-primary)' }}>

      {/* Back */}
      <Link href="/sign-sessions" className="text-sm mb-5 inline-flex items-center gap-1"
        style={{ color: 'var(--c-text-2)' }}>
        ← All sessions
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--c-primary)' }}>{session.title}</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold"
              style={{ backgroundColor: st.bg, color: st.color }}>
              {st.label}
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>
            Created {new Date(session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {session.completed_at && ` · Completed ${new Date(session.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
          </p>
        </div>
        {isCompleted && session.completed_pdf_path && (
          <button
            onClick={downloadSignedPdf}
            disabled={downloadingPdf}
            className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#22c55e', color: '#fff' }}>
            {downloadingPdf ? 'Downloading…' : '⬇ Download Signed PDF'}
          </button>
        )}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Signers', value: session.signers?.length ?? 0 },
          { label: 'Fields', value: totalFields },
          { label: 'Signed', value: session.signer_rows.filter(r => r.status === 'signed').length },
        ].map(item => (
          <div key={item.label} className="rounded-xl p-4 text-center"
            style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <p className="text-2xl font-bold" style={{ color: 'var(--c-primary)' }}>{item.value}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-2)' }}>{item.label}</p>
          </div>
        ))}
      </div>

      {/* Signers */}
      <div className="rounded-2xl overflow-hidden mb-4"
        style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
        <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>Signers</p>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--c-border)' }}>
          {session.signer_rows.map(signer => {
            const ss = SIGNER_STATUS_LABELS[signer.status] ?? SIGNER_STATUS_LABELS.pending
            const signerDef = session.signers.find(s => s.id === signer.signer_ref_id)
            const color = signerDef?.color ?? '#4CAF9A'
            const fieldCount = session.fields.filter(f => f.signer_id === signer.signer_ref_id).length

            return (
              <div key={signer.id} className="px-5 py-4 flex items-center gap-4">
                {/* Color dot */}
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                {/* Name & email */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--c-primary)' }}>
                    {signer.name}
                    {signer.role && <span className="ml-1.5 font-normal" style={{ color: 'var(--c-text-2)' }}>· {signer.role}</span>}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--c-text-2)' }}>{signer.email}</p>
                  {signer.decline_reason && (
                    <p className="text-xs mt-0.5" style={{ color: '#ef4444' }}>
                      Declined: {signer.decline_reason}
                    </p>
                  )}
                </div>
                {/* Field count */}
                <p className="text-xs shrink-0" style={{ color: 'var(--c-text-2)' }}>
                  {fieldCount} field{fieldCount !== 1 ? 's' : ''}
                </p>
                {/* Status */}
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-base">{ss.icon}</span>
                  <span className="text-xs font-semibold" style={{ color: ss.color }}>{ss.label}</span>
                </div>
                {/* Copy link (only if not yet signed and session active) */}
                {!isVoided && !isCompleted && signer.status !== 'signed' && signer.status !== 'declined' && (
                  <button
                    onClick={() => copyLink(signer.token)}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                    style={{
                      backgroundColor: copied === signer.token ? 'rgba(34,197,94,0.12)' : 'var(--c-hover)',
                      color: copied === signer.token ? '#22c55e' : 'var(--c-text-2)',
                    }}>
                    {copied === signer.token ? '✓ Copied' : 'Copy Link'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      {/* Danger zone */}
      {!isCompleted && (
        <div className="rounded-2xl p-5" style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-card)' }}>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--c-primary)' }}>Danger Zone</p>
          <p className="text-xs mb-3" style={{ color: 'var(--c-text-2)' }}>
            Deleting this session is permanent. All signer links will stop working.
          </p>
          {showDeleteConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--c-text-2)' }}>Are you sure?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                style={{ backgroundColor: '#ef4444', color: '#fff' }}>
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-2)' }}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              Delete Session
            </button>
          )}
        </div>
      )}
    </div>
  )
}
