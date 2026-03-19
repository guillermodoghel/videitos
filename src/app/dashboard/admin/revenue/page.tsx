import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CREDIT_KIND } from "@/lib/constants/credit-transaction-kind";
import { CREDIT_MULTIPLIER } from "@/lib/credits";
import { getStripeRevenueFromExternalIds } from "@/lib/stripe-revenue";

/** USD per Runway API credit (cost to buy). $8 buys 800 credits → $0.01 per credit. */
const RUNWAY_USD_PER_API_CREDIT = 0.01;

/** Gain parts of 3: 1 (cost recovery) + 1 + 1. We split real revenue across the two gain parts. */
const GAIN_ONE = 1;
const GAIN_SECOND = 1;
const GAIN_TOTAL = GAIN_ONE + GAIN_SECOND; // 2

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatCredits(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

export default async function AdminRevenuePage() {
  const [transactions, jobAgg] = await Promise.all([
    prisma.creditTransaction.findMany({
      where: {
        kind: { in: [CREDIT_KIND.PURCHASE, CREDIT_KIND.AUTO_RECHARGE] },
        externalId: { not: null },
      },
      select: {
        externalId: true,
        amount: true,
        stripeNetAmountCents: true,
        stripeFeeCents: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.job.aggregate({
      where: { apiCost: { not: null } },
      _sum: { apiCost: true },
    }),
  ]);

  const externalIds = transactions.map((t) => t.externalId).filter((id): id is string => id != null);
  const totalCreditsPurchased = transactions.reduce((acc, t) => acc + Number(t.amount), 0);

  // Prefer DB: we store stripeNetAmountCents and stripeFeeCents in the webhook
  const withStripeData = transactions.filter(
    (t) => t.stripeNetAmountCents != null && t.stripeFeeCents != null
  );
  const incomeFromDbCents = withStripeData.reduce(
    (acc, t) => acc + (t.stripeNetAmountCents ?? 0) + (t.stripeFeeCents ?? 0),
    0
  );
  const feeFromDbCents = withStripeData.reduce((acc, t) => acc + (t.stripeFeeCents ?? 0), 0);
  const netFromDbCents = withStripeData.reduce((acc, t) => acc + (t.stripeNetAmountCents ?? 0), 0);

  let incomeUsd: number;
  let stripeFeeUsd: number;
  let netAfterStripeUsd: number;
  let stripeSource: "db" | "stripe" | "estimate" = "estimate";
  let stripeNote: string | undefined;

  if (withStripeData.length > 0) {
    incomeUsd = incomeFromDbCents / 100;
    stripeFeeUsd = feeFromDbCents / 100;
    netAfterStripeUsd = netFromDbCents / 100;
    stripeSource = "db";
    stripeNote =
      withStripeData.length < transactions.length
        ? `Based on ${withStripeData.length} of ${transactions.length} transactions (Stripe data in DB)`
        : undefined;
  } else {
    try {
      const stripeRevenue = await getStripeRevenueFromExternalIds(externalIds);
      if (stripeRevenue.transactionCount > 0) {
        incomeUsd = stripeRevenue.incomeUsd;
        stripeFeeUsd = stripeRevenue.stripeFeeUsd;
        netAfterStripeUsd = stripeRevenue.netUsd;
        stripeSource = "stripe";
        stripeNote = stripeRevenue.note;
      } else {
        incomeUsd = totalCreditsPurchased / 100;
        stripeFeeUsd = incomeUsd * 0.029 + (transactions.length * 30) / 100;
        netAfterStripeUsd = incomeUsd - stripeFeeUsd;
        stripeNote = "Stripe data unavailable; using estimate";
      }
    } catch {
      incomeUsd = totalCreditsPurchased / 100;
      stripeFeeUsd = incomeUsd * 0.029 + (transactions.length * 30) / 100;
      netAfterStripeUsd = incomeUsd - stripeFeeUsd;
      stripeNote = "Stripe API error; using estimate";
    }
  }

  const totalApiCredits = Number(jobAgg._sum.apiCost ?? 0);
  const runwayCostUsd = totalApiCredits * RUNWAY_USD_PER_API_CREDIT;

  // Real revenue = Income − Stripe − Runway cost (amount that goes to buy Runway credits). Split this into +1 and +1.
  const realRevenueUsd = netAfterStripeUsd - runwayCostUsd;
  const gainOneShare = GAIN_ONE / GAIN_TOTAL;
  const gainSecondShare = GAIN_SECOND / GAIN_TOTAL;
  const revenueFromPlus1 = realRevenueUsd * gainOneShare;
  const revenueFromPlus1Second = realRevenueUsd * gainSecondShare;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Revenue (admin)
        </h1>
        <Link
          href="/dashboard/admin/users"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Users
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Income (Stripe)
          </p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {formatUsd(incomeUsd)}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {formatCredits(totalCreditsPurchased)} credits sold
            {transactions.length > 0 && ` · ${transactions.length} transaction${transactions.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Stripe processing fees
          </p>
          <p className="mt-1 text-2xl font-semibold text-red-600 dark:text-red-400">
            −{formatUsd(stripeFeeUsd)}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {stripeSource === "db"
              ? "From DB (Stripe data saved in webhook)"
              : stripeSource === "stripe"
                ? "From Stripe API"
                : "Estimate"}
            {stripeNote && ` · ${stripeNote}`}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Runway credits to purchase
          </p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {formatCredits(totalApiCredits)} credits
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Runway (API) credits consumed — you sell at {CREDIT_MULTIPLIER}× to users
          </p>
          <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            → {formatUsd(runwayCostUsd)} to buy these (goes out of revenue)
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Revenue flow
        </h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-400">Payment amount</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">{formatUsd(incomeUsd)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-400">Stripe processing fees</dt>
            <dd className="font-medium text-red-600 dark:text-red-400">−{formatUsd(stripeFeeUsd)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-zinc-200 pt-2 dark:border-zinc-700">
            <dt className="text-zinc-500 dark:text-zinc-400">Net amount</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">{formatUsd(netAfterStripeUsd)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-400">Runway credits to purchase</dt>
            <dd className="font-medium text-red-600 dark:text-red-400">−{formatUsd(runwayCostUsd)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-zinc-200 pt-2 dark:border-zinc-700">
            <dt className="font-medium text-zinc-700 dark:text-zinc-300">Real revenue (to split)</dt>
            <dd className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{formatUsd(realRevenueUsd)}</dd>
          </div>
        </dl>

        <div className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-700">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Gain breakdown (proportional to real revenue)
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Multiplier {CREDIT_MULTIPLIER} = 1 (cost) + 1 + 1. Split the two +1 parts:
          </p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">+1 part (1/2)</dt>
              <dd className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                {formatUsd(revenueFromPlus1)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">+1 part (1/2)</dt>
              <dd className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                {formatUsd(revenueFromPlus1Second)}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
