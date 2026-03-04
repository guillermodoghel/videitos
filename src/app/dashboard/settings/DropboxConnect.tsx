"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

export function DropboxConnect() {
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const dropbox = searchParams.get("dropbox");
    const error = searchParams.get("dropbox_error");
    if (dropbox === "connected") {
      setMessage({ type: "ok", text: "Dropbox connected successfully." });
      setConnected(true);
      window.history.replaceState({}, "", "/dashboard/settings");
    }
    if (error) {
      setMessage({ type: "error", text: decodeURIComponent(error) });
      window.history.replaceState({}, "", "/dashboard/settings");
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dropbox/status")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setConnected(!!data.connected);
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/dropbox/disconnect", { method: "POST" });
      if (res.ok) {
        setConnected(false);
        setMessage({ type: "ok", text: "Disconnected from Dropbox." });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to disconnect." });
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          Dropbox
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        Dropbox
      </h2>
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
      {connected ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Connected to Dropbox
          </span>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <a
          href="/api/dropbox/auth"
          className="inline-flex rounded-lg bg-[#0061ff] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0052d9]"
        >
          Connect to Dropbox
        </a>
      )}
    </div>
  );
}
