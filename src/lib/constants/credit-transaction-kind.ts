/**
 * CreditTransaction.kind values.
 */
export const CREDIT_KIND = {
  GRANT: "grant",
  SPEND: "spend",
  PURCHASE: "purchase",
  AUTO_RECHARGE: "auto_recharge",
} as const;

export type CreditKind = (typeof CREDIT_KIND)[keyof typeof CREDIT_KIND];
