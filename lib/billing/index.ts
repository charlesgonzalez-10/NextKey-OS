// lib/billing — Phase 6.6-A public API
// Import from here, never from individual service files directly.

export type {
  PoolKey,
  GrantType,
  CreditSourceType,
  TransactionType,
  ReservationStatus,
  ApiBudgetPool,
  BudgetReservation,
  AccountVendorCostCap,
  CreditWallet,
  CreditGrant,
  SubscriptionPlan,
  AccountSubscription,
  FeaturePricingVersion,
  CreditProduct,
  PromotionType,
  PromotionCode,
  AuthorizationResult,
  GateNumber,
  ProviderCallRequest,
  ProviderCallFinalizeRequest,
  BudgetStatusAdmin,
  CreditLiabilityReport,
  PromoValidationResult,
  ApplicableBenefit,
  CustomerWalletResponse,
  CustomerSubscriptionResponse,
  AdminWalletResponse,
  AdminBudgetPoolResponse,
  PricingEstimateAdmin,
} from './types'

export type {
  IPaymentProvider,
  PaymentProviderCustomer,
  CheckoutSessionRequest,
  CheckoutSessionResult,
  WebhookEvent,
} from './paymentProvider'
export { UnimplementedPaymentProvider } from './paymentProvider'

export type {
  UsageEventAttribution,
  RevenueAttribution,
  FeatureUsageSummary,
  PoolUsageSummary,
  AccountUsageSummary,
  PromotionAnalytics,
} from './analyticsDataModel'

export { apiBudgetService, ApiBudgetService } from './apiBudgetService'
export { accountCostCapService, AccountCostCapService } from './accountCostCapService'
export { creditWalletService, CreditWalletService } from './creditWalletService'
export { pricingEngine, PricingEngine } from './pricingEngine'
export { costCatalogService, CostCatalogService } from './costCatalogService'
export { subscriptionPlanService, SubscriptionPlanService } from './subscriptionPlanService'
export { creditProductService, CreditProductService } from './creditProductService'
export { creditLiabilityService, CreditLiabilityService } from './creditLiabilityService'
export { promotionCodeService, PromotionCodeService } from './promotionCodeService'
export { providerGateway, ProviderGateway } from './providerGateway'

export type { BillingContext, EnrichmentOutcome } from './gatewayContext'
export {
  buildCustomerContext,
  buildOwnerContext,
  BACKGROUND_CONTEXT,
} from './gatewayContext'

export {
  toCustomerWallet,
  toCustomerSubscription,
  toCustomerCreditProduct,
  toAdminWallet,
  toAdminBudgetPool,
  toAdminCostCap,
  toAdminPoolSummary,
} from './responseModels'
