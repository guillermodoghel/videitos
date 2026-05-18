import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { JOB_WORKFLOW_PHASE } from "@/lib/constants/job-workflow-phase";
import { completeJobWithRunwayVideo } from "@/lib/complete-job-with-runway-video";
import { jobCanRetryDropboxUpload } from "@/lib/resolve-runway-video-uri";
import { hasRecoverableJobVideo } from "@/lib/load-job-video-buffer";
import { jobLog, jobLogError } from "@/lib/job-log";

export type RetryDropboxUploadResult =
  | { ok: true; outputDropboxPath: string }
  | {
      ok: false;
      error: string;
      status: number;
      retryAfterSeconds?: number;
    };

async function markDropboxUploadFailed(jobId: string, workflowPhase: string | null): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JOB_STATUS.FAILED,
      errorMessage: JOB_ERROR.DROPBOX_UPLOAD_FAILED,
      workflowPhase,
      completedAt: new Date(),
    },
  });
}

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

  const canRetry = jobCanRetryDropboxUpload(job);
  const hasVideo = await hasRecoverableJobVideo(jobId);
  if (!canRetry && !hasVideo) {
    return {
      ok: false,
      error: `Job cannot retry Dropbox upload (status: ${job.status})`,
      status: 400,
    };
  }

  if (!hasVideo) {
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
    hadExplicitDropboxError: canRetry,
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
    videoUri: job.runwayOutputVideoUri ?? undefined,
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

  if (result.outcome === "already_completed") {
    return {
      ok: true,
      outputDropboxPath: result.outputDropboxPath ?? "",
    };
  }

  if (result.outcome === "dropbox_rate_limited") {
    await markDropboxUploadFailed(jobId, JOB_WORKFLOW_PHASE.WAITING_DROPBOX_RATE_LIMIT);
    return {
      ok: false,
      error: `Dropbox rate limited. Try again in about ${result.retryAfterSeconds} seconds.`,
      status: 429,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }

  const failureMessage =
    result.outcome === "failed"
      ? result.error
      : result.outcome === "skipped"
        ? `Upload skipped: ${result.reason}`
        : "Upload retry failed";

  await markDropboxUploadFailed(jobId, JOB_WORKFLOW_PHASE.UPLOADING);

  jobLogError("retry-dropbox", "upload retry failed", {
    jobId,
    outcome: result.outcome,
    error: failureMessage,
  });

  return {
    ok: false,
    error: failureMessage === "Upload failed" ? JOB_ERROR.DROPBOX_UPLOAD_FAILED : failureMessage,
    status: 500,
  };
}
