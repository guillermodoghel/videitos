"use client";

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

  async function toggleEnabled(id: string, enabled: boolean) {
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (res.ok) router.refresh();
    } catch {
      // ignore
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
              onClick={() => toggleEnabled(t.id, t.enabled)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                t.enabled
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                  : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400"
              }`}
            >
              {t.enabled ? "Enabled" : "Disabled"}
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
