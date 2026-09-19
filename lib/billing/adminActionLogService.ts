// Admin action log: immutable audit trail for all economic mutations.
// Every pricing change, feature toggle, provider wallet update, account cap override,
// bonus credit grant, partner plan assignment, and budget change must be logged here.
// Rows are INSERT-only — never UPDATE.

import { serviceClient } from '@/lib/supabase-service'

export type AdminActionType =
  | 'feature_pricing_update'
  | 'feature_enable'
  | 'feature_disable'
  | 'provider_enable'
  | 'provider_disable'
  | 'provider_wallet_balance_update'
  | 'provider_wallet_refill_verified'
  | 'account_cap_override'
  | 'account_cap_reset'
  | 'bonus_credits_granted'
  | 'plan_assigned'
  | 'promotion_created'
  | 'promotion_updated'
  | 'promotion_deactivated'
  | 'budget_pool_updated'
  | 'budget_policy_updated'

export interface AdminActionLogEntry {
  actor_id:     string
  action_type:  AdminActionType
  entity_type:  string
  entity_id?:   string
  entity_label?: string
  before_value?: Record<string, unknown>
  after_value?:  Record<string, unknown>
  reason?:       string
  ip_address?:   string
  user_agent?:   string
}

class AdminActionLogService {

  async log(entry: AdminActionLogEntry): Promise<void> {
    const { error } = await serviceClient.from('admin_action_log').insert({
      actor_id:     entry.actor_id,
      action_type:  entry.action_type,
      entity_type:  entry.entity_type,
      entity_id:    entry.entity_id    ?? null,
      entity_label: entry.entity_label ?? null,
      before_value: entry.before_value ?? null,
      after_value:  entry.after_value  ?? null,
      reason:       entry.reason       ?? null,
      ip_address:   entry.ip_address   ?? null,
      user_agent:   entry.user_agent   ?? null,
    })

    if (error) {
      // Log failures must not break the mutation that triggered them.
      // Log to stderr only.
      console.error(`[AdminActionLog] Failed to write log entry: ${error.message}`, entry)
    }
  }

  async getRecentActions(limit = 50): Promise<{
    id: string
    actor_id: string
    action_type: string
    entity_type: string
    entity_id: string | null
    entity_label: string | null
    reason: string | null
    created_at: string
  }[]> {
    const { data, error } = await serviceClient
      .from('admin_action_log')
      .select('id, actor_id, action_type, entity_type, entity_id, entity_label, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error(`[AdminActionLog] getRecentActions: ${error.message}`)
      return []
    }

    return (data ?? []) as typeof data extends (infer T)[] ? T[] : never
  }
}

export const adminActionLogService = new AdminActionLogService()
