import { TemplateForm } from "../TemplateForm";
import { VIDEO_MODELS } from "@/lib/video-models";

export default function NewTemplatePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        New template
      </h1>
      <TemplateForm models={VIDEO_MODELS} />
    </div>
  );
}
