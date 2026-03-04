import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
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
  });
  if (!template) notFound();

  const config = parseTemplateConfig(template.model, template.config as object);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Edit template
      </h1>
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
