/**
 * Jobs can stay in `processing` if the workflow webhook returned ok without completing
 * (e.g. stale callback) or the workflow died after Runway finished.
 * Poll Runway for long-running processing jobs and finish them.
 */

import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { getRunwayTaskStatus } from "@/lib/runway";
import { isRunwayImageToVideoModel } from "@/lib/video-models";
import { getRunwayApiKeyForUser } from "@/lib/runway-api-key";
import { completeJobWithRunwayVideo } from "@/lib/complete-job-with-runway-video";
import { jobLog, jobLogError } from "@/lib/job-log";

const STUCK_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 5;

export async function reconcileStuckProcessingJobs(opts?: {
  userId?: string;
  limit?: number;
}): Promise<number> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS);

  const jobs = await prisma.job.findMany({
    where: {
      ...(opts?.userId ? { userId: opts.userId } : {}),
      status: JOB_STATUS.PROCESSING,
      providerOperationId: { not: null },
      updatedAt: { lt: stuckBefore },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      providerOperationId: true,
      template: { select: { model: true } },
      user: { select: { runwayApiKey: true } },
    },
  });

  if (jobs.length === 0) return 0;

  let reconciled = 0;
  for (const job of jobs) {
    const taskId = job.providerOperationId;
    if (!taskId) continue;

    if (!isRunwayImageToVideoModel(job.template.model)) continue;

    const apiKey = await getRunwayApiKeyForUser(job.user.runwayApiKey);
    if (!apiKey) continue;

    try {
      const runwayStatus = await getRunwayTaskStatus(apiKey, taskId);
      if (!runwayStatus.done || !runwayStatus.videoUri) {
        if (runwayStatus.done && runwayStatus.error) {
          jobLog("reconcile", "Runway task failed — not auto-completing", {
            jobId: job.id,
            error: runwayStatus.error,
          });
        }
        continue;
      }

      jobLog("reconcile", "Runway task succeeded — completing stuck job", {
        jobId: job.id,
        taskId,
      });

      const result = await completeJobWithRunwayVideo({
        jobId: job.id,
        videoUri: runwayStatus.videoUri,
        operationName: taskId,
        source: "reconcile-stuck-jobs",
      });

      if (result.outcome === "completed" || result.outcome === "already_completed") {
        reconciled += 1;
        jobLog("reconcile", "job reconciled", { jobId: job.id, outcome: result.outcome });
      }
    } catch (err) {
      jobLogError("reconcile", "reconcile failed for job", {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return reconciled;
}
