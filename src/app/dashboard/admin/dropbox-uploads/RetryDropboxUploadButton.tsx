"use client";

import { useState } from "react";

export function RetryDropboxUploadButton({ jobId }: { jobId: string }) {
  const [pending, setPending] = useState(false);

  async function onRetry() {
    setPending(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/retry-upload`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Retry failed");
        return;
      }
      window.location.reload();
    } catch {
      alert("Retry failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={pending}
      className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
    >
      {pending ? "Retrying..." : "Retry upload"}
    </button>
  );
}
