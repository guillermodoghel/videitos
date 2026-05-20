"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ImpersonationBanner({
  email,
  impersonatorEmail,
}: {
  email: string;
  impersonatorEmail: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onStop() {
    setPending(true);
    try {
      const res = await fetch("/api/admin/impersonate/stop", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to stop impersonation");
        return;
      }
      router.push("/dashboard/admin/users");
      router.refresh();
    } catch {
      alert("Failed to stop impersonation");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-900/50 dark:bg-amber-950/40">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-sm text-amber-900 dark:text-amber-100">
        <span>
          Viewing as <strong>{email}</strong> (signed in as {impersonatorEmail})
        </span>
        <button
          type="button"
          onClick={onStop}
          disabled={pending}
          className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-900"
        >
          {pending ? "Stopping…" : "Stop impersonating"}
        </button>
      </div>
    </div>
  );
}
