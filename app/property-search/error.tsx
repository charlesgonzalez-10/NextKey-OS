'use client'

export default function PropertySearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex items-center justify-center h-full min-h-[300px]"
      style={{ backgroundColor: 'var(--c-bg)' }}>
      <div className="text-center max-w-md px-6">
        <p className="text-4xl mb-4">⚠️</p>
        <h2 className="text-base font-bold mb-2" style={{ color: 'var(--c-primary)' }}>
          Property Search Error
        </h2>
        <p className="text-sm mb-2 font-mono break-all p-3 rounded-xl mb-4"
          style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error?.message || 'Unknown error'}
        </p>
        {error?.stack && (
          <pre className="text-[10px] text-left overflow-auto max-h-40 p-2 rounded-lg mb-4"
            style={{ backgroundColor: 'var(--c-hover)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>
            {error.stack}
          </pre>
        )}
        <button onClick={reset}
          className="text-sm font-bold px-4 py-2 rounded-xl"
          style={{ backgroundColor: 'var(--c-primary)', color: '#C9A84C' }}>
          Try again
        </button>
      </div>
    </div>
  )
}
