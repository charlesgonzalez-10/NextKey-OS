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
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: 'rgba(239,68,68,0.1)' }}>
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#ef4444' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.962-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z"/>
          </svg>
        </div>
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
