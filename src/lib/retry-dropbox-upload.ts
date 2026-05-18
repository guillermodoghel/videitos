import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { JOB_WORKFLOW_PHASE } from "@/lib/constants/job-workflow-phase";
import { completeJobWithRunwayVideo } from "@/lib/complete-job-with-runway-video";
import { resolveRunwayVideoUriForJob, jobCanRetryDropboxUpload } from "@/lib/resolve-runway-video-uri";
import { getObjectBody, pendingJobVideoKey } from "@/lib/s3";
import { jobLog, jobLogError } from "@/lib/job-log";

export type RetryDropboxUploadResult =
  | { ok: true; outputDropboxPath: string }
  | {
      ok: false;
      error: string;
      status: number;
      retryAfterSeconds?: number;
    };

/**
 * Re-upload a Runway video to Dropbox using the stored output URL (no new generation).
 */
export async function retryDropboxUploadForJob(
  jobId: string,
  opts: { userId: string; isAdmin?: boolean }
): Promise<RetryDropboxUploadResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      status: true,
      errorMessage: true,
      providerOperationId: true,
      runwayOutputVideoUri: true,
    },
  });

  if (!job) {
    return { ok: false, error: "Job not found", status: 404 };
  }
  if (!opts.isAdmin && job.userId !== opts.userId) {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const pendingKey = pendingJobVideoKey(job.userId, job.id);
  const hasS3 = !!(await getObjectBody(pendingKey));
  if (!jobCanRetryDropboxUpload(job) && !hasS3) {
    return {
      ok: false,
      error: `Job cannot retry Dropbox upload (status: ${job.status})`,
      status: 400,
    };
  }

  const videoUri = await resolveRunwayVideoUriForJob(jobId);
  if (!videoUri && !hasS3) {
    return {
      ok: false,
      error:
        "Could not recover Runway video (URL expired or task unavailable). Use Retry to regenerate.",
      status: 400,
    };
  }

  jobLog("retry-dropbox", "starting Dropbox upload retry", {
    jobId,
    userId: job.userId,
    providerOperationId: job.providerOperationId,
  });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JOB_STATUS.PROCESSING,
      errorMessage: null,
      completedAt: null,
      workflowPhase: JOB_WORKFLOW_PHASE.UPLOADING,
    },
  });

  const result = await completeJobWithRunwayVideo({
    jobId,
    videoUri: videoUri ?? undefined,
    operationName: job.providerOperationId,
    source: "retry-dropbox-upload",
  });

  if (result.outcome === "completed") {
    jobLog("retry-dropbox", "upload retry succeeded", {
      jobId,
      outputDropboxPath: result.outputDropboxPath,
    });
    return { ok: true, outputDropboxPath: result.outputDropboxPath };
  }

  if (result.outcome === "dropbox_rate_limited") {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JOB_STATUS.FAILED,
        errorMessage: JOB_ERROR.DROPBOX_UPLOAD_FAILED,
        workflowPhase: JOB_WORKFLOW_PHASE.UPLOADING,
        completedAt: new Date(),
      },
    });
    return {
      ok: false,
      error: `Dropbox rate limited. Try again in about ${result.retryAfterSeconds} seconds.`,
      status: 429,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }

  jobLogError("retry-dropbox", "upload retry failed", {
    jobId,
    outcome: result.outcome,
    error: "error" in result ? result.error : result.reason,
  });

  return {
    ok: false,
    error:
      result.outcome === "failed"
        ? result.error
        : result.outcome === "skipped"
          ? `Upload skipped: ${result.reason}`
          : "Upload retry failed",
    status: 500,
  };
}
