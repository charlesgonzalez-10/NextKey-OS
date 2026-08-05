// CostCatalogService: registry of api_providers and api_budget_policies.
// Provides the "catalog" view of what providers exist, their cost models,
// and their per-pool policy limits — all readable by admin UI.

import { serviceClient } from '@/lib/supabase-service'
import type { PoolKey } from './types'

export interface ApiProvider {
  id: string
  provider_key: string
  display_name: string
  category: string
  is_paid: boolean
  billing_model: 'per_call' | 'token' | 'subscription' | 'included_access'
  default_estimated_cost_cents: number
  is_enabled: boolean
  base_url: string | null
  notes: string | null
}

export interface ApiPolicy {
  id: string
  pool_key: PoolKey
  provider_key: string | null
  feature_key: string | null
  monthly_limit_cents: number
  is_enabled: boolean
  kill_switch_reason: string | null
}

export class CostCatalogService {

  async getProviders(include_disabled: boolean = false): Promise<ApiProvider[]> {
    let query = serviceClient.from('api_providers').select('*')
    if (!include_disabled) query = query.eq('is_enabled', true)
    query = query.order('category').order('display_name')

    const { data, error } = await query
    if (error) throw new Error(`CostCatalogService.getProviders: ${error.message}`)
    return data as ApiProvider[]
  }

  async getProvider(provider_key: string): Promise<ApiProvider | null> {
    const { data, error } = await serviceClient
      .from('api_providers')
      .select('*')
      .eq('provider_key', provider_key)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`CostCatalogService.getProvider: ${error.message}`)
    }
    return data as ApiProvider | null
  }

  async setProviderEnabled(provider_key: string, enabled: boolean): Promise<void> {
    const { error } = await serviceClient
      .from('api_providers')
      .update({ is_enabled: enabled, updated_at: new Date().toISOString() })
      .eq('provider_key', provider_key)

    if (error) throw new Error(`CostCatalogService.setProviderEnabled: ${error.message}`)
  }

  async getPolicies(pool_key?: PoolKey): Promise<ApiPolicy[]> {
    let query = serviceClient.from('api_budget_policies').select('*')
    if (pool_key) query = query.eq('pool_key', pool_key)
    query = query.order('pool_key').order('provider_key')

    const { data, error } = await query
    if (error) throw new Error(`CostCatalogService.getPolicies: ${error.message}`)
    return data as ApiPolicy[]
  }

  async upsertPolicy(params: {
    pool_key: PoolKey
    provider_key: string | null
    feature_key: string | null
    monthly_limit_cents: number
    is_enabled?: boolean
  }): Promise<ApiPolicy> {
    const { data, error } = await serviceClient
      .from('api_budget_policies')
      .upsert({
        pool_key: params.pool_key,
        provider_key: params.provider_key,
        feature_key: params.feature_key,
        monthly_limit_cents: params.monthly_limit_cents,
        is_enabled: params.is_enabled ?? true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'pool_key,provider_key,feature_key' })
      .select()
      .single()

    if (error) throw new Error(`CostCatalogService.upsertPolicy: ${error.message}`)
    return data as ApiPolicy
  }

  async togglePolicyKillSwitch(
    pool_key: PoolKey,
    provider_key: string | null,
    feature_key: string | null,
    enabled: boolean,
    reason?: string
  ): Promise<void> {
    let query = serviceClient
      .from('api_budget_policies')
      .update({
        is_enabled: enabled,
        kill_switch_reason: enabled ? null : (reason ?? 'Disabled by admin'),
        updated_at: new Date().toISOString(),
      })
      .eq('pool_key', pool_key)

    if (provider_key) query = query.eq('provider_key', provider_key)
    if (feature_key) query = query.eq('feature_key', feature_key)

    const { error } = await query
    if (error) throw new Error(`CostCatalogService.togglePolicyKillSwitch: ${error.message}`)
  }

  // Returns a summary of all providers with their current policy limits across pools.
  async getProviderSummary(): Promise<Array<ApiProvider & { policies: ApiPolicy[] }>> {
    const [providers, policies] = await Promise.all([
      this.getProviders(true),
      this.getPolicies(),
    ])

    const policyMap = new Map<string, ApiPolicy[]>()
    for (const policy of policies) {
      const key = policy.provider_key ?? '__all__'
      if (!policyMap.has(key)) policyMap.set(key, [])
      policyMap.get(key)!.push(policy)
    }

    return providers.map(p => ({
      ...p,
      policies: policyMap.get(p.provider_key) ?? [],
    }))
  }
}

export const costCatalogService = new CostCatalogService()
