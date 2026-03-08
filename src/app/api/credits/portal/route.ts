import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";

/**
 * POST /api/credits/portal
 * Creates a Stripe Customer Portal session for managing saved payment methods.
 * Returns { url }.
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

  const hostname = process.env.HOSTNAME ?? "http://localhost:3000";

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${hostname}/dashboard/credits`,
  });

  return NextResponse.json({ url: session.url });
}
