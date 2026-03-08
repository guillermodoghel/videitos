import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { resumeInsufficientCreditsJobs } from "@/lib/resume-insufficient-credits-jobs";
import { CREDIT_KIND } from "@/lib/constants/credit-transaction-kind";
import { STRIPE_PI_TYPE } from "@/lib/constants/stripe-metadata";
import type Stripe from "stripe";

/**
 * POST /api/webhook/stripe
 * Handles Stripe webhook events:
 * - checkout.session.completed → grant purchased credits, save default payment method
 * - payment_intent.succeeded   → grant auto-recharge credits
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.error("[stripe-webhook] Invalid signature:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case "setup_intent.succeeded":
        await handleSetupIntentSucceeded(event.data.object as Stripe.SetupIntent);
        break;

      default:
        // Ignore other events
        break;
    }
  } catch (err) {
    console.error("[stripe-webhook] Error handling event %s:", event.type, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/** Returns false if user does not exist (event may be for another product sharing the webhook). */
async function userExists(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  return !!user;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const creditsToGrant = parseInt(session.metadata?.creditsToGrant ?? "0", 10);

  if (!userId || !creditsToGrant) {
    console.warn("[stripe-webhook] checkout.session.completed: missing metadata", session.id);
    return;
  }

  if (!(await userExists(userId))) {
    console.log("[stripe-webhook] checkout.session.completed: user not found, skipping (likely another product)", userId);
    return;
  }

  // Expand payment intent to get the payment method
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      const pmId =
        typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;

      if (pmId) {
        // Set as default payment method on the Stripe customer
        if (session.customer) {
          await stripe.customers.update(session.customer as string, {
            invoice_settings: { default_payment_method: pmId },
          });
        }
        // Save to our DB
        await prisma.user.update({
          where: { id: userId },
          data: { stripeDefaultPaymentMethodId: pmId },
        });
      }
    } catch (err) {
      console.warn("[stripe-webhook] Could not update default payment method:", err);
    }
  }

  const externalId = `checkout_${session.id}`;
  const granted = await grantCredits(userId, creditsToGrant, CREDIT_KIND.PURCHASE, "Credit purchase", externalId);
  if (granted) {
    const n = await resumeInsufficientCreditsJobs(userId);
    if (n > 0) console.log("[stripe-webhook] Re-queued %s job(s) after purchase (user=%s)", n, userId);
  }
}

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  const type = pi.metadata?.type;
  // CREDIT_PURCHASE is already handled by checkout.session.completed; granting here would double-credit
  if (type !== STRIPE_PI_TYPE.AUTO_RECHARGE) return;

  const userId = pi.metadata?.userId;
  const creditsToGrant = parseInt(pi.metadata?.creditsToGrant ?? "0", 10);

  if (!userId || !creditsToGrant) {
    console.warn("[stripe-webhook] payment_intent.succeeded: missing metadata", pi.id);
    return;
  }

  if (!(await userExists(userId))) {
    console.log("[stripe-webhook] payment_intent.succeeded: user not found, skipping (likely another product)", userId);
    return;
  }

  const externalId = `pi_${pi.id}`;

  // AUTO_RECHARGE
  const granted = await grantCredits(userId, creditsToGrant, CREDIT_KIND.AUTO_RECHARGE, "Auto-recharge", externalId);
  if (granted) {
    const n = await resumeInsufficientCreditsJobs(userId);
    if (n > 0) console.log("[stripe-webhook] Re-queued %s job(s) after auto-recharge (user=%s)", n, userId);
  }
}

async function handleSetupIntentSucceeded(si: Stripe.SetupIntent) {
  const userId = si.metadata?.userId;
  if (!userId) return;

  const pmId =
    typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  if (!pmId) return;

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, stripeCustomerId: true, stripeDefaultPaymentMethodId: true },
  });
  if (!dbUser) {
    console.log("[stripe-webhook] setup_intent.succeeded: user not found, skipping (likely another product)", userId);
    return;
  }
  if (!dbUser.stripeCustomerId) return;

  // Set as default if none saved yet
  const updates: Promise<unknown>[] = [
    prisma.user.update({
      where: { id: userId },
      data: { stripeDefaultPaymentMethodId: pmId },
    }),
  ];
  if (!dbUser.stripeDefaultPaymentMethodId) {
    updates.push(
      stripe.customers.update(dbUser.stripeCustomerId, {
        invoice_settings: { default_payment_method: pmId },
      })
    );
  }
  await Promise.all(updates);
  console.log("[stripe-webhook] setup_intent.succeeded: saved PM=%s for user=%s", pmId, userId);
}

async function grantCredits(
  userId: string,
  credits: number,
  kind: string,
  description: string,
  externalId: string
): Promise<boolean> {
  const existing = await prisma.creditTransaction.findUnique({
    where: { externalId },
    select: { id: true },
  });
  if (existing) {
    console.log("[stripe-webhook] Already processed externalId=%s, skipping", externalId);
    return false;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: new Prisma.Decimal(credits) } },
    });
    await tx.creditTransaction.create({
      data: {
        userId,
        amount: new Prisma.Decimal(credits),
        kind,
        description,
        externalId,
      },
    });
  });

  console.log(
    "[stripe-webhook] Granted %s credits to user=%s (externalId=%s)",
    credits,
    userId,
    externalId
  );
  return true;
}

