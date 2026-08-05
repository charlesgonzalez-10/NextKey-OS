import { serviceClient } from '@/lib/supabase-service'
import type {
  CreditWallet,
  CreditGrant,
  GrantType,
  CreditSourceType,
  TransactionType,
  CustomerWalletResponse,
  AdminWalletResponse,
} from './types'

export class CreditWalletService {

  async getWallet(account_id: string): Promise<CreditWallet | null> {
    const { data, error } = await serviceClient
      .from('credit_wallets')
      .select('*')
      .eq('account_id', account_id)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`CreditWalletService.getWallet: ${error.message}`)
    }
    return data as CreditWallet | null
  }

  async ensureWalletExists(account_id: string): Promise<CreditWallet> {
    const existing = await this.getWallet(account_id)
    if (existing) return existing

    const { data, error } = await serviceClient
      .from('credit_wallets')
      .insert({ account_id })
      .select()
      .single()

    if (error) throw new Error(`CreditWalletService.ensureWalletExists: ${error.message}`)
    return data as CreditWallet
  }

  async getAvailableCredits(account_id: string): Promise<number> {
    const wallet = await this.getWallet(account_id)
    if (!wallet) return 0

    return (
      wallet.available_monthly_credits +
      wallet.available_purchased_credits +
      wallet.available_bonus_credits -
      wallet.reserved_credits
    )
  }

  async grantCredits(
    account_id: string,
    amount: number,
    grant_type: GrantType,
    source_type: CreditSourceType,
    source_id?: string,
    expires_at?: string
  ): Promise<CreditGrant> {
    if (amount <= 0) {
      throw new Error('Credit grant amount must be positive')
    }

    const wallet = await this.ensureWalletExists(account_id)

    const { data: grant, error: grantError } = await serviceClient
      .from('credit_grants')
      .insert({
        wallet_id: wallet.id,
        account_id,
        grant_type,
        source_type,
        source_id: source_id ?? null,
        original_credits: amount,
        remaining_credits: amount,
        starts_at: new Date().toISOString(),
        expires_at: expires_at ?? null,
        status: 'active',
      })
      .select()
      .single()

    if (grantError) throw new Error(`CreditWalletService.grantCredits grant: ${grantError.message}`)

    // Update wallet denormalized counters
    const walletUpdate: Partial<Record<string, number | string>> = {
      updated_at: new Date().toISOString(),
    }

    if (grant_type === 'monthly') {
      walletUpdate.available_monthly_credits = wallet.available_monthly_credits + amount
    } else if (grant_type === 'purchased') {
      walletUpdate.available_purchased_credits = wallet.available_purchased_credits + amount
      walletUpdate.lifetime_purchased_credits = wallet.lifetime_purchased_credits + amount
    } else {
      // bonus, temporary, promotional, admin_adjustment, referral
      walletUpdate.available_bonus_credits = wallet.available_bonus_credits + amount
    }

    const { error: walletError } = await serviceClient
      .from('credit_wallets')
      .update(walletUpdate)
      .eq('account_id', account_id)

    if (walletError) {
      throw new Error(`CreditWalletService.grantCredits wallet update: ${walletError.message}`)
    }

    // Immutable ledger entry
    await this.appendTransaction({
      wallet_id: wallet.id,
      account_id,
      transaction_type: grant_type === 'promotional' ? 'promo_grant' : 'grant',
      credits: amount,
      grant_type_source: grant_type === 'admin_adjustment' ? null : grant_type as any,
      related_grant_id: grant.id,
    })

    return grant as CreditGrant
  }

  // Consume credits, drawing from buckets in priority order:
  // expiring bonus/temp → monthly included → non-expiring purchased
  async consumeCredits(
    account_id: string,
    amount: number,
    feature_key: string,
    provider_key: string,
    request_id: string
  ): Promise<void> {
    if (amount <= 0) return

    const wallet = await this.getWallet(account_id)
    if (!wallet) throw new Error('No wallet found for account')

    const available =
      wallet.available_monthly_credits +
      wallet.available_purchased_credits +
      wallet.available_bonus_credits -
      wallet.reserved_credits

    if (available < amount) {
      throw new Error(`Insufficient credits: need ${amount}, have ${available}`)
    }

    // Determine how to draw: expiring bonus first, then monthly, then purchased
    let remaining = amount
    const updates: Partial<Record<string, number | string>> = {}

    // Draw from bonus (expiring first — enforced by grant consumption order)
    if (remaining > 0 && wallet.available_bonus_credits > 0) {
      const draw = Math.min(remaining, wallet.available_bonus_credits)
      updates.available_bonus_credits = wallet.available_bonus_credits - draw
      remaining -= draw
    }

    // Draw from monthly included
    if (remaining > 0 && wallet.available_monthly_credits > 0) {
      const draw = Math.min(remaining, wallet.available_monthly_credits)
      updates.available_monthly_credits = wallet.available_monthly_credits - draw
      remaining -= draw
    }

    // Draw from purchased (non-expiring)
    if (remaining > 0 && wallet.available_purchased_credits > 0) {
      const draw = Math.min(remaining, wallet.available_purchased_credits)
      updates.available_purchased_credits = wallet.available_purchased_credits - draw
      remaining -= draw
    }

    if (remaining > 0) {
      throw new Error('Credit consumption calculation error: remaining > 0 after draw')
    }

    updates.lifetime_consumed_credits = wallet.lifetime_consumed_credits + amount
    updates.updated_at = new Date().toISOString()

    const { error } = await serviceClient
      .from('credit_wallets')
      .update(updates)
      .eq('account_id', account_id)

    if (error) throw new Error(`CreditWalletService.consumeCredits: ${error.message}`)

    await this.appendTransaction({
      wallet_id: wallet.id,
      account_id,
      transaction_type: 'consumption',
      credits: -amount,
      feature_key,
      provider_key,
      request_id,
    })
  }

  async finalizeReservation(
    account_id: string,
    request_id: string,
    actual_credits: number,
    feature_key: string,
    provider_key: string
  ): Promise<void> {
    const { data: reservation, error: resError } = await serviceClient
      .from('credit_reservations')
      .select('*')
      .eq('request_id', request_id)
      .single()

    if (resError || !reservation) {
      throw new Error(`No credit reservation found for request_id: ${request_id}`)
    }

    const { reserved_credits } = reservation

    const { error: updateRes } = await serviceClient
      .from('credit_reservations')
      .update({ status: 'finalized', finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('request_id', request_id)

    if (updateRes) throw new Error(`finalizeReservation credit_res update: ${updateRes.message}`)

    const wallet = await this.getWallet(account_id)
    if (!wallet) throw new Error('No wallet found for account during finalization')

    // Release the reserve lock, then consume actual
    const releaseAmount = reserved_credits
    const consumeAmount = actual_credits

    // Draw from buckets for actual consumption
    let remaining = consumeAmount
    const updates: Partial<Record<string, number | string>> = {
      reserved_credits: Math.max(0, wallet.reserved_credits - releaseAmount),
      updated_at: new Date().toISOString(),
    }

    if (remaining > 0 && wallet.available_bonus_credits > 0) {
      const draw = Math.min(remaining, wallet.available_bonus_credits)
      updates.available_bonus_credits = wallet.available_bonus_credits - draw
      remaining -= draw
    }
    if (remaining > 0 && wallet.available_monthly_credits > 0) {
      const draw = Math.min(remaining, wallet.available_monthly_credits)
      updates.available_monthly_credits = wallet.available_monthly_credits - draw
      remaining -= draw
    }
    if (remaining > 0 && wallet.available_purchased_credits > 0) {
      const draw = Math.min(remaining, wallet.available_purchased_credits)
      updates.available_purchased_credits = wallet.available_purchased_credits - draw
      remaining -= draw
    }

    updates.lifetime_consumed_credits = wallet.lifetime_consumed_credits + consumeAmount

    const { error: walletError } = await serviceClient
      .from('credit_wallets')
      .update(updates)
      .eq('account_id', account_id)

    if (walletError) throw new Error(`finalizeReservation wallet update: ${walletError.message}`)

    await this.appendTransaction({
      wallet_id: wallet.id,
      account_id,
      transaction_type: 'consumption',
      credits: -consumeAmount,
      feature_key,
      provider_key,
      request_id,
    })
  }

  async releaseReservation(account_id: string, request_id: string): Promise<void> {
    const { data: reservation } = await serviceClient
      .from('credit_reservations')
      .select('reserved_credits, wallet_id')
      .eq('request_id', request_id)
      .single()

    if (!reservation) return

    await serviceClient
      .from('credit_reservations')
      .update({ status: 'released', finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('request_id', request_id)

    const { error } = await serviceClient
      .from('credit_wallets')
      .update({
        reserved_credits: serviceClient.rpc as any, // via raw SQL increment below
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', account_id)

    // Use separate decrement
    await serviceClient.rpc('fn_adjust_reserved_credits', {
      p_account_id: account_id,
      p_delta: -reservation.reserved_credits,
    })
  }

  async getActiveGrants(account_id: string): Promise<CreditGrant[]> {
    const { data, error } = await serviceClient
      .from('credit_grants')
      .select('*')
      .eq('account_id', account_id)
      .eq('status', 'active')
      .order('expires_at', { ascending: true, nullsFirst: false })

    if (error) throw new Error(`CreditWalletService.getActiveGrants: ${error.message}`)
    return data as CreditGrant[]
  }

  async expireGrants(): Promise<number> {
    const { data, error } = await serviceClient
      .from('credit_grants')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString())
      .not('expires_at', 'is', null)
      .select('id, account_id, remaining_credits, grant_type')

    if (error) throw new Error(`CreditWalletService.expireGrants: ${error.message}`)

    // Deduct expired bonus/temp credits from wallet balances
    for (const grant of (data ?? [])) {
      if (grant.remaining_credits <= 0) continue
      if (!['bonus', 'temporary', 'promotional'].includes(grant.grant_type)) continue

      await serviceClient
        .from('credit_wallets')
        .update({
          available_bonus_credits: serviceClient.rpc as any,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', grant.account_id)

      await serviceClient.rpc('fn_adjust_bonus_credits', {
        p_account_id: grant.account_id,
        p_delta: -grant.remaining_credits,
      })

      const wallet = await this.getWallet(grant.account_id)
      if (wallet) {
        await this.appendTransaction({
          wallet_id: wallet.id,
          account_id: grant.account_id,
          transaction_type: 'expiry',
          credits: -grant.remaining_credits,
          related_grant_id: grant.id,
        })
      }
    }

    return data?.length ?? 0
  }

  toCustomerResponse(wallet: CreditWallet): CustomerWalletResponse {
    return {
      available_credits:
        wallet.available_monthly_credits +
        wallet.available_purchased_credits +
        wallet.available_bonus_credits -
        wallet.reserved_credits,
      breakdown: {
        monthly: wallet.available_monthly_credits,
        purchased: wallet.available_purchased_credits,
        bonus: wallet.available_bonus_credits,
      },
      status: wallet.status,
    }
  }

  toAdminResponse(wallet: CreditWallet): AdminWalletResponse {
    return {
      ...this.toCustomerResponse(wallet),
      account_id: wallet.account_id,
      reserved_credits: wallet.reserved_credits,
      lifetime_purchased: wallet.lifetime_purchased_credits,
      lifetime_consumed: wallet.lifetime_consumed_credits,
      wallet_id: wallet.id,
      updated_at: wallet.updated_at,
    }
  }

  private async appendTransaction(row: {
    wallet_id: string
    account_id: string
    transaction_type: TransactionType
    credits: number
    grant_type_source?: string | null
    related_grant_id?: string
    feature_key?: string
    provider_key?: string
    request_id?: string
    internal_note?: string
  }): Promise<void> {
    const { error } = await serviceClient.from('credit_transactions').insert({
      wallet_id: row.wallet_id,
      account_id: row.account_id,
      transaction_type: row.transaction_type,
      credits: row.credits,
      grant_type_source: row.grant_type_source ?? null,
      related_grant_id: row.related_grant_id ?? null,
      feature_key: row.feature_key ?? null,
      provider_key: row.provider_key ?? null,
      request_id: row.request_id ?? null,
      internal_note: row.internal_note ?? null,
      status: 'completed',
    })
    if (error) {
      // Log but don't throw — ledger append failure should not block the user operation
      console.error(`[CreditWalletService] Ledger append error: ${error.message}`)
    }
  }
}

export const creditWalletService = new CreditWalletService()
