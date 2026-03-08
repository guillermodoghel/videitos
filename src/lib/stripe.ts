import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  throw new Error("STRIPE_SECRET_KEY is not set");
}

export const stripe = new Stripe(key, {
  apiVersion: "2026-02-25.clover",
});

/** 1 USD = 100 credits, 1 credit = $0.01 */
export const CREDITS_PER_DOLLAR = 100;
export const MIN_PURCHASE_USD = 10;
export const MAX_PURCHASE_USD = 500;

/**
 * Ensure a Stripe customer exists for this user.
 * Creates one if missing, saves stripeCustomerId to DB.
 */
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
  name: string | null
): Promise<string> {
  const { prisma } = await import("@/lib/prisma");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });

  if (user?.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email,
    name: name ?? undefined,
    metadata: { userId },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

/**
 * Trigger an off-session auto-recharge for a user if:
 * - autoRechargeEnabled is true
 * - balance < autoRechargeThreshold
 * - user has a saved payment method
 * - not triggered within cooldown (2 min in prod, 0 in dev)
 *
 * Schedules a PaymentIntent; credits are granted via the Stripe webhook
 * when payment_intent.succeeded fires.
 */
export async function maybeAutoRecharge(userId: string, retryJobId?: string): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const { Prisma } = await import("@prisma/client");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      creditBalance: true,
      stripeCustomerId: true,
      stripeDefaultPaymentMethodId: true,
      autoRechargeEnabled: true,
      autoRechargeThreshold: true,
      autoRechargeAmount: true,
      autoRechargeLastTriggeredAt: true,
    },
  });

  if (!user) {
    console.log("[auto-recharge] user=%s not found, skipping", userId);
    return;
  }
  if (!user.autoRechargeEnabled) {
    console.log("[auto-recharge] user=%s autoRecharge not enabled, skipping", userId);
    return;
  }
  if (!user.autoRechargeThreshold || !user.autoRechargeAmount) {
    console.log("[auto-recharge] user=%s threshold/amount not set, skipping", userId);
    return;
  }
  if (!user.stripeCustomerId || !user.stripeDefaultPaymentMethodId) {
    console.log("[auto-recharge] user=%s no Stripe customer or payment method, skipping", userId);
    return;
  }

  const balance = Number(user.creditBalance);
  const threshold = Number(user.autoRechargeThreshold);
  if (balance >= threshold) {
    console.log(
      "[auto-recharge] user=%s balance=%s >= threshold=%s, skipping",
      userId,
      balance,
      threshold
    );
    return;
  }

  console.log(
    "[auto-recharge] user=%s balance=%s < threshold=%s, will recharge=%s credits (retryJobId=%s)",
    userId,
    balance,
    threshold,
    Number(user.autoRechargeAmount),
    retryJobId ?? "none"
  );

  const cooldownMs = process.env.NODE_ENV === "production" ? 2 * 60 * 1000 : 0;
  if (cooldownMs > 0 && user.autoRechargeLastTriggeredAt) {
    const msSince = Date.now() - user.autoRechargeLastTriggeredAt.getTime();
    if (msSince < cooldownMs) {
      console.log(
        "[auto-recharge] user=%s cooldown active (%ss ago), skipping",
        userId,
        Math.round(msSince / 1000)
      );
      return;
    }
  }

  const creditsToGrant = Number(user.autoRechargeAmount);
  const amountUsd = creditsToGrant / CREDITS_PER_DOLLAR;
  const amountCents = Math.round(amountUsd * 100);

  // Mark as triggered before attempting (prevents parallel double-trigger)
  await prisma.user.update({
    where: { id: userId },
    data: { autoRechargeLastTriggeredAt: new Date() },
  });

  const { STRIPE_PI_TYPE } = await import("@/lib/constants/stripe-metadata");
  try {
    await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: user.stripeCustomerId,
      payment_method: user.stripeDefaultPaymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        type: STRIPE_PI_TYPE.AUTO_RECHARGE,
        userId,
        creditsToGrant: creditsToGrant.toString(),
        ...(retryJobId ? { retryJobId } : {}),
      },
    });
    // Credits are granted in the Stripe webhook (payment_intent.succeeded)
    console.log(
      "[auto-recharge] PaymentIntent created for user=%s credits=%s",
      userId,
      creditsToGrant
    );
  } catch (err) {
    // Payment failed — reset the trigger time so the user can retry
    await prisma.user.update({
      where: { id: userId },
      data: { autoRechargeLastTriggeredAt: null },
    });
    console.error("[auto-recharge] PaymentIntent failed for user=%s", userId, err);
  }

  void Prisma; // suppress unused import warning
}
