import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import NewSessionClient from './new-session-client'

export const dynamic = 'force-dynamic'

export default async function NewSignSessionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <NewSessionClient />
}
