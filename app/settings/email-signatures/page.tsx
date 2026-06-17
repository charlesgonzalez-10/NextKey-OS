import { Suspense } from 'react'
import EmailSignaturesClient from './email-signatures-client'

export default function EmailSignaturesPage() {
  return (
    <Suspense>
      <EmailSignaturesClient />
    </Suspense>
  )
}
