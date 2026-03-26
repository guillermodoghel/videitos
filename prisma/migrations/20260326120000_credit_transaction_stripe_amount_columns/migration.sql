-- Stripe fee breakdown for purchase / auto_recharge (schema already had these fields; DB was missing them)
ALTER TABLE "videitos"."CreditTransaction"
  ADD COLUMN "stripeNetAmountCents" INTEGER,
  ADD COLUMN "stripeFeeCents" INTEGER;
