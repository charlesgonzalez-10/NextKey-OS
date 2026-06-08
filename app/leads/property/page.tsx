/**
 * /leads/property?q=ADDRESS&county=COUNTY
 *
 * Universal property detail page — works for any South Florida property,
 * regardless of whether it's in the scraper_leads database.
 *
 * If the property IS a lead, shows a banner with a link to the full lead detail.
 */

import { createClient } from '@/lib/supabase/server'
import { redirect }     from 'next/navigation'
import DashboardLayout  from '../../layout-dashboard'
import PropertyDetailClient from './property-detail-client'
import { searchProperty } from '@/lib/enrichment/property-search'
import type { County }  from '@/lib/enrichment/types'

export const dynamic = 'force-dynamic'

export default async function PropertyDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; county?: string }>
}) {
  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { q, county } = await searchParams

  if (!q) redirect('/leads')

  // Fetch property data server-side
  let property = null
  let fetchError: string | null = null

  try {
    property = await searchProperty(q, county as County | undefined)
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to load property data'
  }

  return (
    <DashboardLayout>
      <PropertyDetailClient
        query={q}
        property={property}
        error={fetchError}
      />
    </DashboardLayout>
  )
}
