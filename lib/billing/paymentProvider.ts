// Payment provider abstraction — Phase A types only.
// No live payment integration until Phase D.
// Interface is Stripe-compatible but not hardcoded to Stripe.

export interface PaymentProviderCustomer {
  external_customer_id: string
  email: string
  name?: string
  metadata?: Record<string, string>
}

export interface CheckoutSessionRequest {
  account_id: string
  external_customer_id: string
  line_items: CheckoutLineItem[]
  success_url: string
  cancel_url: string
  idempotency_key: string
  metadata?: Record<string, string>
  promotion_code?: string
}

export interface CheckoutLineItem {
  price_id: string
  quantity: number
}

export interface CheckoutSessionResult {
  session_id: string
  checkout_url: string
  expires_at: string
}

export interface WebhookEvent {
  event_id: string
  event_type: string
  provider: string
  payload: Record<string, unknown>
  received_at: string
}

export interface SubscriptionRecord {
  external_subscription_id: string
  external_customer_id: string
  status: string
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
  metadata: Record<string, string>
}

export interface PaymentRecord {
  external_payment_id: string
  amount_cents: number
  currency: string
  status: string
  metadata: Record<string, string>
}

// Implement this interface in Phase D with the chosen provider SDK.
// Credits must only be granted from a verified server-side webhook call —
// never from a browser redirect or client-side confirmation.
export interface IPaymentProvider {
  name: string

  createCustomer(
    account_id: string,
    email: string,
    name?: string
  ): Promise<PaymentProviderCustomer>

  createCheckoutSession(
    request: CheckoutSessionRequest
  ): Promise<CheckoutSessionResult>

  getSubscription(
    external_subscription_id: string
  ): Promise<SubscriptionRecord>

  cancelSubscription(
    external_subscription_id: string,
    at_period_end: boolean
  ): Promise<SubscriptionRecord>

  verifyWebhookSignature(
    payload: string,
    signature: string
  ): Promise<WebhookEvent>

  getPayment(
    external_payment_id: string
  ): Promise<PaymentRecord>
}

// Stub for Phase A — always throws; replaced in Phase D.
export class UnimplementedPaymentProvider implements IPaymentProvider {
  name = 'unimplemented'

  private notReady(): never {
    throw new Error(
      'Live payment integration is not active. Phase D required.'
    )
  }

  createCustomer(): Promise<PaymentProviderCustomer>               { return Promise.reject(this.notReady()) }
  createCheckoutSession(): Promise<CheckoutSessionResult>          { return Promise.reject(this.notReady()) }
  getSubscription(): Promise<SubscriptionRecord>                   { return Promise.reject(this.notReady()) }
  cancelSubscription(): Promise<SubscriptionRecord>               { return Promise.reject(this.notReady()) }
  verifyWebhookSignature(): Promise<WebhookEvent>                  { return Promise.reject(this.notReady()) }
  getPayment(): Promise<PaymentRecord>                             { return Promise.reject(this.notReady()) }
}
