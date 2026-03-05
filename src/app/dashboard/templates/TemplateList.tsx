"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type TemplateRow = {
  id: string;
  name: string;
  model: string;
  modelLabel: string;
  enabled: boolean;
  createdAt: Date | string;
};

export function TemplateList({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggleEnabled(id: string, currentEnabled: boolean) {
    const nextEnabled = !currentEnabled;
    setTogglingId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // ignore
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    try {
      const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } catch {
      // ignore
    }
  }

  if (templates.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-400">
          No templates yet. Create one to get started.
        </p>
        <Link
          href="/dashboard/templates/new"
          className="mt-4 inline-block text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100"
        >
          New template
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {templates.map((t) => (
        <li
          key={t.id}
          className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="min-w-0 flex-1">
            <Link
              href={`/dashboard/templates/${t.id}`}
              className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
            >
              {t.name}
            </Link>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t.modelLabel}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={t.enabled}
              aria-label={t.enabled ? "Disable template" : "Enable template"}
              disabled={togglingId === t.id}
              onClick={() => toggleEnabled(t.id, t.enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                t.enabled
                  ? "bg-green-600 dark:bg-green-500"
                  : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  t.enabled ? "translate-x-6" : "translate-x-0.5"
                }`}
              />
            </button>
            <Link
              href={`/dashboard/templates/${t.id}`}
              className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Edit
            </Link>
            <button
              type="button"
              onClick={() => deleteTemplate(t.id)}
              className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
