import { Suspense } from 'react'
import OfferProfilesClient from './offer-profiles-client'

export default function OfferProfilesPage() {
  return (
    <Suspense>
      <OfferProfilesClient />
    </Suspense>
  )
}
