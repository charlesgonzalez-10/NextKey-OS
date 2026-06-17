import { Suspense } from 'react'
import DashboardLayout from '@/app/layout-dashboard'
import SearchResultsClient from './results-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Search Results — NextKey OS' }

export default function SearchResultsPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col h-full">
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
                style={{ borderColor: '#C9A84C', borderTopColor: 'transparent' }} />
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Loading results…</p>
            </div>
          </div>
        }>
          <SearchResultsClient />
        </Suspense>
      </div>
    </DashboardLayout>
  )
}
