import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { archiveJobOutputHistory } from "@/lib/archive-job-output-history";
import { startJobWorkflow } from "@/lib/start-job-workflow";
import { cancelRunwayTaskForJob } from "@/lib/cancel-runway-task-for-job";
import { deleteJobOutputVideo, deletePendingJobVideo } from "@/lib/s3";
import { JOB_STATUS } from "@/lib/constants/job-status";
import {
  jobConfigOverrideForDb,
  type JobConfigOverride,
} from "@/lib/job-config-override";
import { jobLog, jobLogError } from "@/lib/job-log";

const HOSTNAME = process.env.HOSTNAME ?? "http://localhost:3000";

type RerunMode = "retry" | "retake";

const ALLOWED_STATUSES: Record<RerunMode, readonly string[]> = {
  retry: [JOB_STATUS.FAILED],
  retake: [JOB_STATUS.COMPLETED],
};

const BASE_RESET = {
  status: JOB_STATUS.QUEUED,
  errorMessage: null,
  dropboxUploadErrorDetail: null,
  workflowPhase: null,
  workflowRunId: null,
  runwayProgress: null,
  runwayPollStatus: null,
  runwayOutputVideoUri: null,
  completedAt: null,
  providerOperationId: null,
  sentAt: null,
  rateLimitClaimedAt: null,
  configOverride: Prisma.DbNull,
} as const;

const RETAKE_EXTRA_RESET = {
  outputDropboxPath: null,
  apiCost: null,
  creditCost: null,
  preGenImageKey: null,
} as const;

export type RerunJobResult =
  | { ok: true; jobId: string }
  | { ok: false; error: string; status: number };

export type RerunJobOptions = {
  /** Retake-only: per-run video prompt override (does not update the template). */
  configOverride?: JobConfigOverride | null;
};

/** Reset job and start workflow again (retry failed, or retake completed). */
export async function rerunJob(
  jobId: string,
  mode: RerunMode,
  options?: RerunJobOptions
): Promise<RerunJobResult> {
  jobLog("rerun", "requested", { jobId, mode });

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, templateId: true, userId: true },
  });

  if (!job) {
    jobLogError("rerun", "job not found", { jobId, mode });
    return { ok: false, error: "Job not found", status: 404 };
  }

  if (!ALLOWED_STATUSES[mode].includes(job.status)) {
    const verb = mode === "retake" ? "retaken" : "retried";
    jobLogError("rerun", "invalid status for rerun", {
      jobId,
      mode,
      status: job.status,
    });
    return {
      ok: false,
      error: `Job cannot be ${verb} (status: ${job.status})`,
      status: 400,
    };
  }

  if (mode === "retake") {
    try {
      const archived = await archiveJobOutputHistory(jobId);
      if (!archived.ok) {
        jobLogError("rerun", "archive output history failed", {
          jobId,
          error: archived.error,
        });
        return {
          ok: false,
          error:
            archived.error === "No output to archive"
              ? "Job has no output to retake"
              : "Failed to archive previous output. Run database migrations if this persists.",
          status: 500,
        };
      }
    } catch (err) {
      jobLogError("rerun", "archive output history failed", {
        jobId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        error:
          "Failed to archive previous output (JobOutput table may be missing). Run database migrations.",
        status: 500,
      };
    }
  }

  try {
    await deletePendingJobVideo(job.userId, jobId);
    if (mode === "retake") {
      await deleteJobOutputVideo(job.userId, jobId);
    }
  } catch (err) {
    jobLogError("rerun", "failed to clear S3 video cache (continuing)", {
      jobId,
      mode,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const configOverrideValue =
    mode === "retake" ? jobConfigOverrideForDb(options?.configOverride ?? null) : null;

  await cancelRunwayTaskForJob(jobId);

  await prisma.job.update({
    where: { id: jobId },
    data:
      mode === "retake"
        ? {
            ...BASE_RESET,
            ...RETAKE_EXTRA_RESET,
            configOverride:
              configOverrideValue != null
                ? (configOverrideValue as Prisma.InputJsonValue)
                : Prisma.DbNull,
          }
        : BASE_RESET,
  });

  jobLog("rerun", "job reset to queued", {
    jobId,
    mode,
    userId: job.userId,
    templateId: job.templateId,
    previousStatus: job.status,
  });

  const started = await startJobWorkflow({
    jobId: job.id,
    callbackBaseUrl: HOSTNAME.replace(/\/$/, ""),
  });

  if (!started) {
    jobLogError("rerun", "workflow start failed after reset", { jobId, mode });
    return { ok: false, error: "Failed to start job workflow", status: 500 };
  }

  jobLog("rerun", "workflow restarted", { jobId, mode });
  return { ok: true, jobId: job.id };
}
