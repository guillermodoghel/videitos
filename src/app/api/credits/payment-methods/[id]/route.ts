import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/credits/payment-methods/[id]
 * Detaches the payment method from the Stripe customer.
 * If it was the default, clears stripeDefaultPaymentMethodId in DB.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: pmId } = await params;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stripeCustomerId: true, stripeDefaultPaymentMethodId: true },
  });

  // Verify the PM belongs to this customer before detaching
  if (!dbUser?.stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe customer" }, { status: 400 });
  }

  const pm = await stripe.paymentMethods.retrieve(pmId);
  const customerId =
    typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (customerId !== dbUser.stripeCustomerId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await stripe.paymentMethods.detach(pmId);

  // If deleted card was the default, clear it in DB
  if (dbUser.stripeDefaultPaymentMethodId === pmId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeDefaultPaymentMethodId: null },
    });
  }

  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/credits/payment-methods/[id]
 * Sets the given payment method as the default for this customer.
 */
export async function PATCH(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: pmId } = await params;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stripeCustomerId: true },
  });

  if (!dbUser?.stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe customer" }, { status: 400 });
  }

  // Verify PM belongs to this customer
  const pm = await stripe.paymentMethods.retrieve(pmId);
  const customerId =
    typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (customerId !== dbUser.stripeCustomerId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await Promise.all([
    stripe.customers.update(dbUser.stripeCustomerId, {
      invoice_settings: { default_payment_method: pmId },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { stripeDefaultPaymentMethodId: pmId },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
