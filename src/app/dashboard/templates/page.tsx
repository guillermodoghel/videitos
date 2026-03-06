import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { getModelById } from "@/lib/video-models";
import { getTemplateEstimatedCredits } from "@/lib/credits";
import { TemplateList } from "./TemplateList";

export default async function TemplatesPage() {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const templates = await prisma.template.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const templatesWithModelName = templates.map((t) => ({
    ...t,
    modelLabel: getModelById(t.model)?.name ?? t.model,
    creditsPerVideo: getTemplateEstimatedCredits(t.model, t.config),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Templates
        </h1>
        <Link
          href="/dashboard/templates/new"
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          New template
        </Link>
      </div>
      <TemplateList templates={templatesWithModelName} />
    </div>
  );
}
