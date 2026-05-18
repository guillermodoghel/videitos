import { prisma } from "@/lib/prisma";
import { cancelRunwayTask } from "@/lib/runway";
import { getRunwayApiKeyForUser } from "@/lib/runway-api-key";
import { isRunwayImageToVideoModel } from "@/lib/video-models";
import { jobLog, jobLogError } from "@/lib/job-log";

/** Best-effort cancel of an in-flight Runway generation task. */
export async function cancelRunwayTaskForJob(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      providerOperationId: true,
      user: { select: { runwayApiKey: true } },
      template: { select: { model: true } },
    },
  });

  const taskId = job?.providerOperationId?.trim();
  if (!job || !taskId || !isRunwayImageToVideoModel(job.template.model)) {
    return;
  }

  const apiKey = await getRunwayApiKeyForUser(job.user.runwayApiKey);
  if (!apiKey) {
    jobLogError("runway:cancel", "no API key for cancel", { jobId, taskId });
    return;
  }

  const result = await cancelRunwayTask(apiKey, taskId);
  if (result.ok) {
    jobLog("runway:cancel", "task cancel requested", { jobId, taskId, httpStatus: result.status });
  } else {
    jobLogError("runway:cancel", "task cancel failed", {
      jobId,
      taskId,
      httpStatus: result.status,
    });
  }
}
