import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  stripe,
  getOrCreateStripeCustomer,
  CREDITS_PER_DOLLAR,
  MIN_PURCHASE_USD,
  MAX_PURCHASE_USD,
} from "@/lib/stripe";

/**
 * POST /api/credits/purchase
 * Body: { amountUsd: number }
 * Charges the user's default saved payment method directly (off-session PaymentIntent).
 * Credits are granted via the Stripe webhook (payment_intent.succeeded, type=credit_purchase).
 * Returns { ok: true } on success.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { amountUsd?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const amountUsd = typeof body.amountUsd === "number" ? body.amountUsd : NaN;
  if (
    !Number.isFinite(amountUsd) ||
    amountUsd < MIN_PURCHASE_USD ||
    amountUsd > MAX_PURCHASE_USD
  ) {
    return NextResponse.json(
      { error: `Amount must be between $${MIN_PURCHASE_USD} and $${MAX_PURCHASE_USD}` },
      { status: 400 }
    );
  }

  const stripeCustomerId = await getOrCreateStripeCustomer(user.id, user.email, user.name);

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stripeDefaultPaymentMethodId: true },
  });

  if (!dbUser?.stripeDefaultPaymentMethodId) {
    return NextResponse.json({ error: "No saved payment method" }, { status: 400 });
  }

  const creditsToGrant = Math.round(amountUsd * CREDITS_PER_DOLLAR);
  const amountCents = Math.round(amountUsd * 100);

  try {
    await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: stripeCustomerId,
      payment_method: dbUser.stripeDefaultPaymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        type: "credit_purchase",
        userId: user.id,
        creditsToGrant: creditsToGrant.toString(),
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Payment failed. Please try again.";
    console.error("[credits/purchase] PaymentIntent failed for user=%s", user.id, err);
    return NextResponse.json({ error: message }, { status: 402 });
  }

  return NextResponse.json({ ok: true });
}
