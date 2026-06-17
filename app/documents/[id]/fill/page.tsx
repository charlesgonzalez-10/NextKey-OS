import { Suspense } from 'react'
import FillClient from './fill-client'

export default async function FillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--c-text-2)' }}>Loading…</div>}>
      <FillClient docId={id} />
    </Suspense>
  )
}
