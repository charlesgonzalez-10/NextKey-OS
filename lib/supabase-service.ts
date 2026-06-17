/**
 * Lazy Supabase service-role client — safe to import at module level.
 *
 * `serviceClient` is a Proxy that defers `createClient()` until the first
 * method call. This means you can safely write:
 *
 *   import { serviceClient as service } from '@/lib/supabase-service'
 *   const service = serviceClient   ← no createClient call yet
 *
 * `createClient` only runs when the first property is accessed (e.g.,
 * `service.from(...)`) which happens at request time inside a handler,
 * where env vars ARE available.
 *
 * Previously, having `const service = createClient(url, key)` at the
 * module top level caused Next.js build failures on Vercel because env
 * vars are not present during the "collecting page data" phase.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

function getRealClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _client
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const serviceClient: SupabaseClient = new Proxy({} as any, {
  get(_target, prop: string | symbol) {
    const client = getRealClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (client as any)[prop]
    // Bind methods so `this` is the real client, not the Proxy
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    return typeof val === 'function' ? (val as Function).bind(client) : val
  },
  apply(_target, _this, args) {
    return (getRealClient() as unknown as Function)(...args)
  },
})
