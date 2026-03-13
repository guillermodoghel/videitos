/**
 * Fetch real payment amount and Stripe fees for our credit transactions.
 * Uses Stripe API (PaymentIntent / Checkout Session) to get balance_transaction.
 */

import { stripe } from "@/lib/stripe";

export type StripeRevenueResult = {
  /** Total payment amount (gross) in USD */
  incomeUsd: number;
  /** Total Stripe fees in USD */
  stripeFeeUsd: number;
  /** Net after Stripe (income − fee) in USD */
  netUsd: number;
  /** Number of Stripe transactions successfully fetched */
  transactionCount: number;
  /** If some could not be fetched (e.g. old or deleted), we still return what we got */
  note?: string;
};

const BATCH_SIZE = 10;
const MAX_TRANSACTIONS = 500;

function getBalanceTransactionFromPaymentIntent(piId: string): Promise<{ amount: number; fee: number } | null> {
  return stripe.paymentIntents
    .retrieve(piId, { expand: ["latest_charge.balance_transaction"] })
    .then((pi) => {
      const charge = pi.latest_charge;
      if (!charge || typeof charge === "string") return null;
      const bt = charge.balance_transaction;
      if (!bt || typeof bt === "string") return null;
      return { amount: bt.amount, fee: bt.fee };
    })
    .catch(() => null);
}

async function getPaymentIntentIdFromCheckoutSession(sessionId: string): Promise<string | null> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
  const pi = session.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? pi : pi.id;
}

/**
 * For each of our credit transaction externalIds (pi_xxx or checkout_cs_xxx),
 * fetch the Stripe balance transaction and sum amount + fee.
 */
export async function getStripeRevenueFromExternalIds(
  externalIds: string[]
): Promise<StripeRevenueResult> {
  const unique = [...new Set(externalIds)].filter(Boolean).slice(0, MAX_TRANSACTIONS);
  let totalAmount = 0;
  let totalFee = 0;
  let fetched = 0;

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (externalId) => {
        if (externalId.startsWith("pi_")) {
          const bt = await getBalanceTransactionFromPaymentIntent(externalId);
          return bt;
        }
        if (externalId.startsWith("checkout_")) {
          const sessionId = externalId.replace(/^checkout_/, "");
          const piId = await getPaymentIntentIdFromCheckoutSession(sessionId);
          if (!piId) return null;
          return getBalanceTransactionFromPaymentIntent(piId);
        }
        return null;
      })
    );
    for (const r of results) {
      if (r) {
        totalAmount += r.amount;
        totalFee += r.fee;
        fetched++;
      }
    }
  }

  const incomeUsd = totalAmount / 100;
  const stripeFeeUsd = totalFee / 100;
  const netUsd = incomeUsd - stripeFeeUsd;
  const note =
    unique.length > 0 && fetched < unique.length
      ? `Based on ${fetched} of ${unique.length} transactions (Stripe data)`
      : undefined;

  return {
    incomeUsd,
    stripeFeeUsd,
    netUsd,
    transactionCount: fetched,
    note,
  };
}
