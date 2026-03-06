"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Transaction = {
  id: string;
  amount: number;
  kind: string;
  description: string | null;
  createdAt: string;
  job: {
    id: string;
    status: string;
    templateName: string;
    model: string;
    createdAt: string;
  } | null;
};

export function CreditsView() {
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const perPage = 20;

  useEffect(() => {
    fetch("/api/credits", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.balance === "number") setBalance(data.balance);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/credits/transactions?page=${page}&perPage=${perPage}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setTransactions(data.transactions ?? []);
          setTotal(data.total ?? 0);
        }
      })
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Balance
        </h2>
        <p className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
          {balance != null ? (
            <span>{balance.toFixed(2)} credits</span>
          ) : (
            <span className="text-zinc-400">—</span>
          )}
        </p>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Credits are charged when a video job completes. Contact an admin to
          add credits.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          Transaction history
        </h2>
        {loading ? (
          <p className="p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Loading…
          </p>
        ) : transactions.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No transactions yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-800/80">
                  <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    Date
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    Type
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    Amount
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                    Job
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-zinc-100 dark:border-zinc-700/50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {formatDate(t.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {t.kind === "grant" ? "Grant" : "Video generation"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          t.amount >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {t.amount >= 0 ? "+" : ""}
                        {t.amount.toFixed(2)} credits
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {t.job ? (
                        <Link
                          href="/dashboard/jobs"
                          className="text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                        >
                          {t.job.templateName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Page {page} of {totalPages} ({total} total)
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
