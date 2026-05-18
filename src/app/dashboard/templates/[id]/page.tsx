import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { VIDEO_MODELS, parseTemplateConfig } from "@/lib/video-models";
import { TemplateForm } from "../TemplateForm";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const { id } = await params;
  const template = await prisma.template.findFirst({
    where: { id, userId },
    include: {
      _count: {
        select: {
          jobs: { where: { status: JOB_STATUS.COMPLETED } },
        },
      },
    },
  });
  if (!template) notFound();

  const config = parseTemplateConfig(template.model, template.config as object);
  const completedVideosCount = template._count.jobs;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Edit template
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">
            {completedVideosCount}
          </span>{" "}
          {completedVideosCount === 1 ? "video generado" : "videos generados"} con este template
        </p>
      </div>
      <TemplateForm
        models={VIDEO_MODELS}
        templateId={template.id}
        initialName={template.name}
        initialModel={template.model}
        initialEnabled={template.enabled}
        initialConfig={config}
        initialDropboxSourcePath={template.dropboxSourcePath}
        initialDropboxDestinationPath={template.dropboxDestinationPath}
      />
    </div>
  );
}
