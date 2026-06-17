import { Suspense } from 'react'
import DocDetailClient from './detail-client'

export default async function DocDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--c-text-2)' }}>Loading…</div>}>
      <DocDetailClient docId={id} />
    </Suspense>
  )
}
