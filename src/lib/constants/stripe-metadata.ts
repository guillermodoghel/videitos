/**
 * Stripe metadata type for payment intents (auto-recharge).
 */
export const STRIPE_PI_TYPE = {
  AUTO_RECHARGE: "auto_recharge",
  CREDIT_PURCHASE: "credit_purchase",
} as const;
