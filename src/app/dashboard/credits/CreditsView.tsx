"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import { CREDIT_KIND } from "@/lib/constants/credit-transaction-kind";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

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

type PaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

type AutoRechargeSettings = {
  enabled: boolean;
  threshold: number | null;
  amount: number | null;
  hasPaymentMethod: boolean;
};

const CREDITS_PER_DOLLAR = 100;
const PRESETS_USD = [10, 20, 50, 100, 200, 500];
const RECHARGE_AMOUNT_PRESETS_USD = [10, 20, 50, 100];

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "14px",
      color: "#18181b",
      fontFamily: "inherit",
      "::placeholder": { color: "#a1a1aa" },
    },
    invalid: { color: "#dc2626" },
  },
};

// ── Brand icon (text badge) ───────────────────────────────────────────────────

function CardBrand({ brand }: { brand: string }) {
  const labels: Record<string, string> = {
    visa: "VISA",
    mastercard: "MC",
    amex: "AMEX",
    discover: "DISC",
    jcb: "JCB",
    unionpay: "UP",
    diners: "DC",
  };
  return (
    <span className="inline-flex h-6 w-12 items-center justify-center rounded border border-zinc-200 bg-zinc-50 text-[10px] font-bold tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
      {labels[brand] ?? brand.toUpperCase().slice(0, 4)}
    </span>
  );
}

// ── Add card form (uses Stripe Elements, mounted inside an Elements provider) ─

function AddCardForm({
  clientSecret,
  onSuccess,
  onCancel,
}: {
  clientSecret: string;
  onSuccess: (pmId: string) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    if (!name.trim()) {
      setError("Please enter the cardholder name.");
      return;
    }

    setLoading(true);
    setError(null);

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    const { setupIntent, error: stripeError } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: { name: name.trim() },
      },
    });

    if (stripeError) {
      setError(stripeError.message ?? "Card setup failed");
      setLoading(false);
      return;
    }

    const pmId =
      typeof setupIntent?.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id ?? "";
    onSuccess(pmId);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Cardholder name
        </label>
        <input
          type="text"
          placeholder="Jane Smith"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="cc-name"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Card details
        </label>
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-700 dark:bg-zinc-800">
          <CardElement options={CARD_ELEMENT_OPTIONS} />
        </div>
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!stripe || loading}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {loading ? "Saving…" : "Save card"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Payment methods panel ─────────────────────────────────────────────────────

function PaymentMethodsPanel({
  onLastCardRemoved,
  onCardAdded,
}: {
  onLastCardRemoved: () => void;
  onCardAdded: () => void;
}) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/credits/payment-methods", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setMethods(data.paymentMethods ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openAddForm() {
    const res = await fetch("/api/credits/payment-methods", {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json();
    if (data.clientSecret) {
      setClientSecret(data.clientSecret);
      setShowAddForm(true);
    }
  }

  async function handleDelete(pmId: string) {
    const isLast = methods.length === 1;
    setActionLoading(pmId);
    await fetch(`/api/credits/payment-methods/${pmId}`, {
      method: "DELETE",
      credentials: "include",
    });
    setActionLoading(null);
    if (isLast) {
      // Disable auto-recharge on the server, then notify parent to refresh that panel
      await fetch("/api/credits/auto-recharge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
        credentials: "include",
      });
      onLastCardRemoved();
    }
    load();
  }

  async function handleSetDefault(pmId: string) {
    setActionLoading(pmId);
    await fetch(`/api/credits/payment-methods/${pmId}`, {
      method: "PATCH",
      credentials: "include",
    });
    setActionLoading(null);
    load();
  }

  async function handleAddSuccess(pmId: string) {
    setShowAddForm(false);
    setClientSecret(null);
    // If this is the first card, immediately set it as default
    if (methods.length === 0 && pmId) {
      await fetch(`/api/credits/payment-methods/${pmId}`, {
        method: "PATCH",
        credentials: "include",
      });
    }
    onCardAdded();
    load();
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Payment methods
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Saved cards used for purchases and auto-recharge.
          </p>
        </div>
        {!showAddForm && (
          <button
            type="button"
            onClick={openAddForm}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            + Add card
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : methods.length === 0 && !showAddForm ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No saved cards yet.</p>
      ) : (
        <ul className="space-y-2">
          {methods.map((pm) => (
            <li
              key={pm.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50/50 px-3 py-2.5 dark:border-zinc-700/50 dark:bg-zinc-800/50"
            >
              <CardBrand brand={pm.brand} />
              <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">
                •••• {pm.last4}
                <span className="ml-2 text-xs text-zinc-400">
                  {pm.expMonth}/{String(pm.expYear).slice(-2)}
                </span>
              </span>
              {pm.isDefault && (
                <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                  Default
                </span>
              )}
              {!pm.isDefault && (
                <button
                  type="button"
                  onClick={() => handleSetDefault(pm.id)}
                  disabled={actionLoading === pm.id}
                  className="text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-40 dark:hover:text-zinc-200"
                >
                  Set default
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDelete(pm.id)}
                disabled={actionLoading === pm.id}
                className="ml-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {showAddForm && clientSecret && (
        <Elements stripe={stripePromise}>
          <AddCardForm
            clientSecret={clientSecret}
            onSuccess={handleAddSuccess}
            onCancel={() => { setShowAddForm(false); setClientSecret(null); }}
          />
        </Elements>
      )}
    </div>
  );
}

// ── Buy Credits Modal ─────────────────────────────────────────────────────────

function BuyCreditsModal({ onClose, onSuccess }: { onClose: () => void; onSuccess?: () => void }) {
  const [selectedUsd, setSelectedUsd] = useState(20);
  const [customUsd, setCustomUsd] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [defaultPm, setDefaultPm] = useState<PaymentMethod | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    fetch("/api/credits/payment-methods", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const methods: PaymentMethod[] = data?.paymentMethods ?? [];
        setDefaultPm(methods.find((m) => m.isDefault) ?? null);
      })
      .catch(() => setDefaultPm(null));
  }, []);

  const effectiveUsd = useCustom ? parseFloat(customUsd) || 0 : selectedUsd;
  const credits = Math.round(effectiveUsd * CREDITS_PER_DOLLAR);
  const valid = effectiveUsd >= 10 && effectiveUsd <= 500;

  async function handleBuy() {
    if (!valid) return;
    setLoading(true);
    setError(null);

    // If there's a saved default payment method, charge it directly
    if (defaultPm) {
      try {
        const res = await fetch("/api/credits/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountUsd: effectiveUsd }),
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Payment failed. Please try again.");
          return;
        }
        setSuccess(true);
        onSuccess?.();
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    // No saved card — redirect to Stripe Checkout
    try {
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsd: effectiveUsd }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Add credits</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {success ? (
          <div className="py-4 text-center">
            <p className="mb-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              +{credits.toLocaleString()} credits
            </p>
            <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">
              Payment successful. Credits will appear in your balance shortly.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
              1 credit = $0.01 &nbsp;·&nbsp; Min $10 &nbsp;·&nbsp; Max $500
            </p>

            <div className="mb-3 grid grid-cols-3 gap-2">
              {PRESETS_USD.map((usd) => (
                <button
                  key={usd}
                  type="button"
                  onClick={() => { setSelectedUsd(usd); setUseCustom(false); }}
                  className={[
                    "rounded-lg border py-2.5 text-sm font-medium transition-colors",
                    !useCustom && selectedUsd === usd
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                  ].join(" ")}
                >
                  ${usd}
                  <span className="block text-xs font-normal opacity-60">
                    {usd * CREDITS_PER_DOLLAR} cr
                  </span>
                </button>
              ))}
            </div>

            <div className="mb-5">
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Custom amount (USD)
              </label>
              <input
                type="number"
                min={10}
                max={500}
                step={1}
                placeholder="e.g. 35"
                value={customUsd}
                onFocus={() => setUseCustom(true)}
                onChange={(e) => { setCustomUsd(e.target.value); setUseCustom(true); }}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              />
            </div>

            <div className="mb-5 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">You&apos;ll receive</span>
                <span className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {valid ? credits.toLocaleString() : "—"} credits
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">Total</span>
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {valid ? `$${effectiveUsd.toFixed(2)}` : "—"}
                </span>
              </div>
              {defaultPm && (
                <div className="mt-2 flex items-center gap-1.5 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                  <CardBrand brand={defaultPm.brand} />
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    •••• {defaultPm.last4}
                  </span>
                </div>
              )}
            </div>

            {error && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleBuy}
              disabled={!valid || loading || defaultPm === undefined}
              className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {loading
                ? defaultPm ? "Processing…" : "Redirecting…"
                : defaultPm
                  ? `Pay $${valid ? effectiveUsd.toFixed(2) : "—"}`
                  : `Checkout $${valid ? effectiveUsd.toFixed(2) : "—"}`}
            </button>
            {!defaultPm && defaultPm !== undefined && (
              <p className="mt-2 text-center text-xs text-zinc-400 dark:text-zinc-500">
                You&apos;ll be redirected to Stripe Checkout to complete payment.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Auto-recharge panel ───────────────────────────────────────────────────────

function AutoRechargePanel({ refreshKey }: { refreshKey: number }) {
  const [settings, setSettings] = useState<AutoRechargeSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState("100");
  const [amountUsd, setAmountUsd] = useState(20);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/credits/auto-recharge", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AutoRechargeSettings | null) => {
        if (!data) return;
        setSettings(data);
        setEnabled(data.enabled);
        if (data.threshold != null) setThreshold(String(data.threshold));
        if (data.amount != null) setAmountUsd(data.amount / CREDITS_PER_DOLLAR);
      });
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const body = enabled
        ? {
            enabled: true,
            threshold: parseFloat(threshold) || 0,
            amount: Math.round(amountUsd * CREDITS_PER_DOLLAR),
          }
        : { enabled: false };

      const res = await fetch("/api/credits/auto-recharge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Auto-recharge</h2>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Automatically top up your balance when it runs low. Requires a saved card.
      </p>

      {settings && !settings.hasPaymentMethod && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          No saved card. Add a card above, then enable auto-recharge.
        </p>
      )}

      <label className="mb-4 flex cursor-pointer items-center gap-3">
        <span className="relative inline-block h-6 w-10 flex-shrink-0">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="absolute inset-0 rounded-full bg-zinc-200 transition-colors peer-checked:bg-zinc-900 dark:bg-zinc-700 dark:peer-checked:bg-zinc-100" />
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4 dark:bg-zinc-900" />
        </span>
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </label>

      {enabled && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Recharge when balance drops below (credits)
            </label>
            <input
              type="number"
              min={1}
              step={10}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Recharge amount
            </label>
            <div className="grid grid-cols-4 gap-2">
              {RECHARGE_AMOUNT_PRESETS_USD.map((usd) => (
                <button
                  key={usd}
                  type="button"
                  onClick={() => setAmountUsd(usd)}
                  className={[
                    "rounded-lg border py-2 text-sm font-medium transition-colors",
                    amountUsd === usd
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                  ].join(" ")}
                >
                  ${usd}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Adds {Math.round(amountUsd * CREDITS_PER_DOLLAR).toLocaleString()} credits
            </p>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
      {saved && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
          Settings saved.
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function CreditsView() {
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [autoRechargeRefreshKey, setAutoRechargeRefreshKey] = useState(0);

  const perPageOptions = [10, 20, 50];

  const loadBalance = useCallback(() => {
    fetch("/api/credits", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.balance === "number") setBalance(data.balance);
      });
  }, []);

  useEffect(() => {
    loadBalance();
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "1") {
      window.history.replaceState({}, "", "/dashboard/credits");
    }
    const interval = setInterval(loadBalance, 10_000);
    return () => clearInterval(interval);
  }, [loadBalance]);

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
  }, [page, perPage]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function kindLabel(kind: string): string {
    switch (kind) {
      case CREDIT_KIND.GRANT: return "Admin grant";
      case CREDIT_KIND.PURCHASE: return "Credit purchase";
      case CREDIT_KIND.AUTO_RECHARGE: return "Auto-recharge";
      case CREDIT_KIND.SPEND: return "Video generation";
      default: return kind;
    }
  }

  return (
    <>
      {showBuyModal && (
        <BuyCreditsModal
          onClose={() => setShowBuyModal(false)}
          onSuccess={loadBalance}
        />
      )}

      <div className="space-y-6">
        {/* Balance */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">Balance</h2>
          <div className="flex items-end justify-between gap-4">
            <p className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
              {balance != null ? (
                <span>{balance.toFixed(2)} credits</span>
              ) : (
                <span className="text-zinc-400">—</span>
              )}
            </p>
            <button
              type="button"
              onClick={() => setShowBuyModal(true)}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Add credits
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            1 credit = $0.01 &nbsp;·&nbsp; Credits are deducted when a video job completes.
          </p>
        </div>

        {/* Payment methods */}
        <PaymentMethodsPanel
          onLastCardRemoved={() => setAutoRechargeRefreshKey((k) => k + 1)}
          onCardAdded={() => setAutoRechargeRefreshKey((k) => k + 1)}
        />

        {/* Auto-recharge */}
        <AutoRechargePanel refreshKey={autoRechargeRefreshKey} />

        {/* Transaction history */}
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
            Transaction history
          </h2>
          {loading ? (
            <p className="p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
          ) : transactions.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No transactions yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-800/80">
                    <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Date</th>
                    <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Type</th>
                    <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Amount</th>
                    <th className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Job</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id} className="border-b border-zinc-100 dark:border-zinc-700/50">
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">
                        {formatDate(t.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                        {kindLabel(t.kind)}
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Page {page} of {totalPages}
              {total > 0 && (
                <> · {total} transaction{total === 1 ? "" : "s"} total</>
              )}
            </p>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                Per page
                <select
                  value={perPage}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setPerPage(next);
                    setPage(1);
                  }}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {perPageOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
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
          </div>
        </div>
      </div>
    </>
  );
}
