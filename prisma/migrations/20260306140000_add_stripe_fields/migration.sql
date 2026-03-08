-- Add Stripe customer/payment fields and auto-recharge settings to User
ALTER TABLE "videitos"."User"
  ADD COLUMN "stripeCustomerId"             TEXT,
  ADD COLUMN "stripeDefaultPaymentMethodId" TEXT,
  ADD COLUMN "autoRechargeEnabled"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoRechargeThreshold"        DECIMAL(14,4),
  ADD COLUMN "autoRechargeAmount"           DECIMAL(14,4),
  ADD COLUMN "autoRechargeLastTriggeredAt"  TIMESTAMP(3);

-- Add externalId to CreditTransaction for Stripe idempotency
ALTER TABLE "videitos"."CreditTransaction"
  ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "CreditTransaction_externalId_key"
  ON "videitos"."CreditTransaction"("externalId")
  WHERE "externalId" IS NOT NULL;
