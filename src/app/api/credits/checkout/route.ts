import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  stripe,
  getOrCreateStripeCustomer,
  CREDITS_PER_DOLLAR,
  MIN_PURCHASE_USD,
  MAX_PURCHASE_USD,
} from "@/lib/stripe";

/**
 * POST /api/credits/checkout
 * Body: { amountUsd: number }
 * Creates a Stripe Checkout session and returns { url }.
 * On success Stripe sends checkout.session.completed → /api/webhook/stripe grants credits.
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

  const stripeCustomerId = await getOrCreateStripeCustomer(
    user.id,
    user.email,
    user.name
  );

  const creditsToGrant = Math.round(amountUsd * CREDITS_PER_DOLLAR);
  const amountCents = Math.round(amountUsd * 100);
  const hostname = process.env.HOSTNAME ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${creditsToGrant} credits`,
            description: `Add ${creditsToGrant} credits to your Videitos account`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: {
        type: "credit_purchase",
        userId: user.id,
        creditsToGrant: creditsToGrant.toString(),
      },
    },
    metadata: {
      userId: user.id,
      creditsToGrant: creditsToGrant.toString(),
    },
    success_url: `${hostname}/dashboard/credits?success=1`,
    cancel_url: `${hostname}/dashboard/credits`,
  });

  return NextResponse.json({ url: session.url });
}
