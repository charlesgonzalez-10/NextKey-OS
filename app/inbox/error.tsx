'use client'

export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="p-8 flex flex-col items-start justify-center min-h-screen gap-4 max-w-3xl mx-auto">
      <p className="text-red-500 font-semibold text-lg">Inbox failed to load</p>
      <p className="text-sm text-gray-700 font-mono bg-gray-100 px-3 py-2 rounded w-full">{error.message}</p>
      {error.stack && (
        <pre className="text-xs text-gray-500 bg-gray-100 px-3 py-2 rounded w-full overflow-auto max-h-64 whitespace-pre-wrap">
          {error.stack}
        </pre>
      )}
      <button
        onClick={reset}
        className="px-4 py-2 rounded-xl text-sm font-semibold"
        style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
      >
        Try again
      </button>
    </div>
  )
}
