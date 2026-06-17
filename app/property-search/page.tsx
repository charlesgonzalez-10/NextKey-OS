import DashboardLayout from '@/app/layout-dashboard'
import PropertySearchClient from './page-client'

export const dynamic = 'force-dynamic'

export default function PropertySearchPage() {
  return (
    <DashboardLayout>
      <PropertySearchClient />
    </DashboardLayout>
  )
}
