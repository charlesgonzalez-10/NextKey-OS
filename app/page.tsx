import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import LandingPage from './_landing/LandingPage'

export const metadata: Metadata = {
  title: 'NextKey | Real Estate Intelligence & Deal Management',
  description:
    'A unified real estate platform for property discovery, intelligence, relationship management, and deal execution. Built by NextKey Property Solutions.',
  robots: 'index, follow',
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return <LandingPage isAuthenticated={!!user} />
}
