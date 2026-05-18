import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { getRunwayTaskStatus } from "@/lib/runway";
import { isRunwayImageToVideoModel } from "@/lib/video-models";
import { getRunwayApiKeyForUser } from "@/lib/runway-api-key";
import { persistRunwayVideoUri } from "@/lib/persist-runway-video-uri";
import { getObjectBody, pendingJobVideoKey } from "@/lib/s3";
import { jobLog } from "@/lib/job-log";

/**
 * Find a Runway output URL for Dropbox upload retry: DB field, S3 cache, or Runway task poll.
 */
export async function resolveRunwayVideoUriForJob(jobId: string): Promise<string | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      runwayOutputVideoUri: true,
      providerOperationId: true,
      user: { select: { runwayApiKey: true } },
      template: { select: { model: true } },
    },
  });

  if (!job) return null;

  if (job.runwayOutputVideoUri) {
    return job.runwayOutputVideoUri;
  }

  const taskId = job.providerOperationId;
  if (!taskId || !isRunwayImageToVideoModel(job.template.model)) {
    return null;
  }

  const apiKey = await getRunwayApiKeyForUser(job.user.runwayApiKey);
  if (!apiKey) return null;

  const status = await getRunwayTaskStatus(apiKey, taskId);
  if (status.videoUri) {
    await persistRunwayVideoUri(jobId, status.videoUri);
    jobLog("resolve-runway-uri", "fetched video URI from Runway task", {
      jobId,
      taskId,
      runwayStatus: status.runwayStatus ?? null,
    });
    return status.videoUri;
  }

  jobLog("resolve-runway-uri", "Runway task has no video URI", {
    jobId,
    taskId,
    done: status.done,
    error: status.error ?? null,
    runwayStatus: status.runwayStatus ?? null,
  });
  return null;
}

/** Whether Dropbox-only retry is possible without re-running generation. */
export function jobCanRetryDropboxUpload(job: {
  status: string;
  errorMessage: string | null;
  runwayOutputVideoUri: string | null;
  providerOperationId: string | null;
}): boolean {
  return (
    job.status === JOB_STATUS.FAILED &&
    job.errorMessage === JOB_ERROR.DROPBOX_UPLOAD_FAILED &&
    (!!job.runwayOutputVideoUri || !!job.providerOperationId)
  );
}
