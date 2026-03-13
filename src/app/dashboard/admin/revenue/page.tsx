import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CREDIT_KIND } from "@/lib/constants/credit-transaction-kind";
import { CREDIT_MULTIPLIER } from "@/lib/credits";
import { CREDITS_PER_DOLLAR } from "@/lib/stripe";

/** If set (e.g. 0.059 for 5.9%), Stripe fee = income × this. Else: 2.9% + $0.30 per transaction. */
const STRIPE_FEE_PERCENT = process.env.STRIPE_FEE_PERCENT
  ? parseFloat(process.env.STRIPE_FEE_PERCENT)
  : null;
const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED_CENTS = 30;
/** USD per Runway API credit. Required for real revenue (amount that goes to buy Runway credits). e.g. 8/60 ≈ 0.1333 if 60 credits cost $8. */
const RUNWAY_USD_PER_API_CREDIT = process.env.RUNWAY_USD_PER_API_CREDIT
  ? parseFloat(process.env.RUNWAY_USD_PER_API_CREDIT)
  : null;

/** Gain parts of 2.5: 1 (cost recovery) + 1 + 0.5. We attribute net revenue to the +1 and +0.5 parts proportionally. */
const GAIN_ONE = 1;
const GAIN_HALF = 0.5;
const GAIN_TOTAL = GAIN_ONE + GAIN_HALF; // 1.5

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
  const [purchaseAgg, jobAgg] = await Promise.all([
    prisma.creditTransaction.groupBy({
      by: ["kind"],
      where: {
        kind: { in: [CREDIT_KIND.PURCHASE, CREDIT_KIND.AUTO_RECHARGE] },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.job.aggregate({
      where: { apiCost: { not: null } },
      _sum: { apiCost: true },
    }),
  ]);

  const totalCreditsPurchased = purchaseAgg.reduce(
    (acc, row) => acc + Number(row._sum.amount ?? 0),
    0
  );
  const purchaseCount = purchaseAgg.reduce((acc, row) => acc + row._count, 0);

  const incomeUsd = totalCreditsPurchased / CREDITS_PER_DOLLAR;
  const stripeFeeUsd =
    STRIPE_FEE_PERCENT != null && Number.isFinite(STRIPE_FEE_PERCENT)
      ? incomeUsd * STRIPE_FEE_PERCENT
      : incomeUsd * STRIPE_PERCENT + (purchaseCount * STRIPE_FIXED_CENTS) / 100;
  const netAfterStripeUsd = incomeUsd - stripeFeeUsd;

  const totalApiCredits = Number(jobAgg._sum.apiCost ?? 0);
  const runwayCostUsd =
    RUNWAY_USD_PER_API_CREDIT != null && Number.isFinite(RUNWAY_USD_PER_API_CREDIT)
      ? totalApiCredits * RUNWAY_USD_PER_API_CREDIT
      : 0;

  // Real revenue = Income − Stripe − Runway cost (amount that goes to buy Runway credits). Split this into +1 and +0.5.
  const realRevenueUsd = netAfterStripeUsd - runwayCostUsd;
  const gainOneShare = GAIN_ONE / GAIN_TOTAL;
  const gainHalfShare = GAIN_HALF / GAIN_TOTAL;
  const revenueFromPlus1 = realRevenueUsd * gainOneShare;
  const revenueFromPlus05 = realRevenueUsd * gainHalfShare;

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
            {purchaseCount > 0 && ` · ${purchaseCount} transaction${purchaseCount === 1 ? "" : "s"}`}
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
            {STRIPE_FEE_PERCENT != null && Number.isFinite(STRIPE_FEE_PERCENT)
              ? `${(STRIPE_FEE_PERCENT * 100).toFixed(1)}% of payment`
              : `${(STRIPE_PERCENT * 100).toFixed(1)}% + $${STRIPE_FIXED_CENTS / 100} per transaction`}
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
          {RUNWAY_USD_PER_API_CREDIT != null && Number.isFinite(RUNWAY_USD_PER_API_CREDIT) ? (
            <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              → {formatUsd(runwayCostUsd)} to buy these (goes out of revenue)
            </p>
          ) : (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Set RUNWAY_USD_PER_API_CREDIT for real revenue
            </p>
          )}
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
          {RUNWAY_USD_PER_API_CREDIT != null && Number.isFinite(RUNWAY_USD_PER_API_CREDIT) && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500 dark:text-zinc-400">Runway credits to purchase</dt>
                <dd className="font-medium text-red-600 dark:text-red-400">−{formatUsd(runwayCostUsd)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                <dt className="font-medium text-zinc-700 dark:text-zinc-300">Real revenue (to split)</dt>
                <dd className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{formatUsd(realRevenueUsd)}</dd>
              </div>
            </>
          )}
        </dl>

        <div className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-700">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Gain breakdown (proportional to real revenue)
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Multiplier {CREDIT_MULTIPLIER} = 1 (cost) + 1 + 0.5. Split the +1 and +0.5 parts:
          </p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">+1 part (⅔)</dt>
              <dd className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                {formatUsd(revenueFromPlus1)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">+0.5 part (⅓)</dt>
              <dd className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                {formatUsd(revenueFromPlus05)}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
