"use client";

import { useState, useEffect } from "react";

export function RunwayApiKeyForm() {
  const [apiKey, setApiKey] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/settings")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setMasked(data.runwayApiKey ?? null);
        setHasKey(!!data.hasRunwayApiKey);
      })
      .catch(() => {
        if (!cancelled) setMasked(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runwayApiKey: apiKey.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage({ type: "error", text: data.error ?? "Failed to save" });
        return;
      }
      setMessage({ type: "ok", text: "Saved." });
      setApiKey("");
      setMasked(apiKey.trim() ? "••••••••" + apiKey.trim().slice(-4) : null);
      setHasKey(!!apiKey.trim());
    } catch {
      setMessage({ type: "error", text: "Something went wrong" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        Runway API key
      </h2>
      {hasKey && masked && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Current key: <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-700">{masked}</code>
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="runway-api-key" className="sr-only">
            Runway API key
          </label>
          <input
            id="runway-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? "Enter new key to replace" : "Enter your API key"}
            autoComplete="off"
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-900 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-400"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
      {message && (
        <p
          className={
            message.type === "ok"
              ? "text-sm text-green-600 dark:text-green-400"
              : "text-sm text-red-600 dark:text-red-400"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
