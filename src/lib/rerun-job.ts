import { prisma } from "@/lib/prisma";
import { archiveJobOutputHistory } from "@/lib/archive-job-output-history";
import { startJobWorkflow } from "@/lib/start-job-workflow";
import { deletePendingJobVideo } from "@/lib/s3";
import { JOB_STATUS } from "@/lib/constants/job-status";
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
  workflowPhase: null,
  workflowRunId: null,
  runwayProgress: null,
  runwayPollStatus: null,
  runwayOutputVideoUri: null,
  completedAt: null,
  providerOperationId: null,
  sentAt: null,
  rateLimitClaimedAt: null,
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

/** Reset job and start workflow again (retry failed, or retake completed). */
export async function rerunJob(jobId: string, mode: RerunMode): Promise<RerunJobResult> {
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
      await archiveJobOutputHistory(jobId);
    } catch (err) {
      jobLogError("rerun", "archive output history failed (continuing retake)", {
        jobId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    await deletePendingJobVideo(job.userId, jobId);
  } catch (err) {
    jobLogError("rerun", "failed to clear pending S3 video (continuing)", {
      jobId,
      mode,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await prisma.job.update({
    where: { id: jobId },
    data: mode === "retake" ? { ...BASE_RESET, ...RETAKE_EXTRA_RESET } : BASE_RESET,
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
