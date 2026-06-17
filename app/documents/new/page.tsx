import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../../layout-dashboard'
import DocumentComposerClient from './document-composer-client'

export const metadata = { title: 'New Document — NextKey OS' }

export default async function NewDocumentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <DashboardLayout>
      <Suspense fallback={<div style={{ padding: 40, color: 'var(--c-text-2)' }}>Loading…</div>}>
        <DocumentComposerClient />
      </Suspense>
    </DashboardLayout>
  )
}
