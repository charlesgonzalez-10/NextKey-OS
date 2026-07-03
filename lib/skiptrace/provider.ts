// Abstract provider interface — all skip trace providers implement this.
// Adding a new provider (IDI, TLO, BatchSkipTracing) requires only:
//   1. Create lib/skiptrace/providers/<name>.ts implementing SkipTraceProvider
//   2. Register it in service.ts

import type { SkipTraceInput, SkipTraceProviderResult } from './types'

export interface SkipTraceProvider {
  readonly name: string
  run(input: SkipTraceInput): Promise<SkipTraceProviderResult>
}
