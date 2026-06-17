import { Suspense } from 'react'
import ContractDefaultsClient from './contract-defaults-client'

export default function ContractDefaultsPage() {
  return (
    <Suspense>
      <ContractDefaultsClient />
    </Suspense>
  )
}
