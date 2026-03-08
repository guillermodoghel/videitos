import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";

/**
 * GET /api/credits/payment-methods
 * Returns the list of saved cards for the current user.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stripeCustomerId: true, stripeDefaultPaymentMethodId: true },
  });

  if (!dbUser?.stripeCustomerId) {
    return NextResponse.json({ paymentMethods: [], defaultId: null });
  }

  const customer = await stripe.customers.retrieve(dbUser.stripeCustomerId);
  if (customer.deleted) {
    return NextResponse.json({ paymentMethods: [], defaultId: null });
  }

  const defaultId =
    (typeof customer.invoice_settings?.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : customer.invoice_settings?.default_payment_method?.id) ??
    dbUser.stripeDefaultPaymentMethodId ??
    null;

  const pms = await stripe.paymentMethods.list({
    customer: dbUser.stripeCustomerId,
    type: "card",
  });

  const paymentMethods = pms.data.map((pm) => ({
    id: pm.id,
    brand: pm.card?.brand ?? "unknown",
    last4: pm.card?.last4 ?? "????",
    expMonth: pm.card?.exp_month ?? 0,
    expYear: pm.card?.exp_year ?? 0,
    isDefault: pm.id === defaultId,
  }));

  return NextResponse.json({ paymentMethods, defaultId });
}

/**
 * POST /api/credits/payment-methods
 * Creates a Stripe SetupIntent and returns { clientSecret } for the client
 * to collect and save a new card via Stripe Elements.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeCustomerId = await getOrCreateStripeCustomer(
    user.id,
    user.email,
    user.name
  );

  const setupIntent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: { userId: user.id },
  });

  return NextResponse.json({ clientSecret: setupIntent.client_secret });
}
