import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import BuilderClient from './builder-client'

export const metadata = { title: 'Template Builder — NextKey OS' }

export default async function BuilderPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--c-text-2)', backgroundColor: 'var(--c-bg)', minHeight: '100vh' }}>Loading…</div>}>
      <BuilderClient />
    </Suspense>
  )
}
