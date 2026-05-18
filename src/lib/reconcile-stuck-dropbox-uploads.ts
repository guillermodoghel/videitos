/**
 * Jobs can sit on "Uploading to Dropbox" when the workflow slept on a 429 and died,
 * or while waiting a long retry-after. Video is usually already in S3 — finish upload here.
 */

import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { JOB_WORKFLOW_PHASE } from "@/lib/constants/job-workflow-phase";
import { completeJobWithRunwayVideo } from "@/lib/complete-job-with-runway-video";
import { getObjectBody, pendingJobVideoKey } from "@/lib/s3";
import { jobLog, jobLogError } from "@/lib/job-log";

/** After this long in upload phase, try finishing from S3 / stored Runway URL. */
const STUCK_UPLOAD_MS = 90 * 1000;
const DEFAULT_LIMIT = 5;

const UPLOAD_PHASES = [
  JOB_WORKFLOW_PHASE.UPLOADING,
  JOB_WORKFLOW_PHASE.WAITING_DROPBOX_RATE_LIMIT,
] as const;

export async function reconcileStuckDropboxUploads(opts?: {
  userId?: string;
  limit?: number;
}): Promise<number> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const stuckBefore = new Date(Date.now() - STUCK_UPLOAD_MS);

  const jobs = await prisma.job.findMany({
    where: {
      ...(opts?.userId ? { userId: opts.userId } : {}),
      status: JOB_STATUS.PROCESSING,
      workflowPhase: { in: [...UPLOAD_PHASES] },
      updatedAt: { lt: stuckBefore },
      OR: [{ runwayOutputVideoUri: { not: null } }, { providerOperationId: { not: null } }],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      providerOperationId: true,
      runwayOutputVideoUri: true,
    },
  });

  if (jobs.length === 0) return 0;

  let finished = 0;
  for (const job of jobs) {
    const hasS3 = !!(await getObjectBody(pendingJobVideoKey(job.userId, job.id)));
    if (!hasS3 && !job.runwayOutputVideoUri) {
      continue;
    }

    try {
      jobLog("reconcile-dropbox", "attempting stuck Dropbox upload", {
        jobId: job.id,
        hasStoredUri: !!job.runwayOutputVideoUri,
        hasS3,
        providerOperationId: job.providerOperationId,
      });

      const result = await completeJobWithRunwayVideo({
        jobId: job.id,
        videoUri: job.runwayOutputVideoUri,
        operationName: job.providerOperationId,
        source: "reconcile-stuck-dropbox",
      });

      if (result.outcome === "dropbox_rate_limited") {
        jobLog("reconcile-dropbox", "still rate limited — will retry on next poll", {
          jobId: job.id,
          retryAfterSeconds: result.retryAfterSeconds,
        });
        continue;
      }
      if (result.outcome === "completed" || result.outcome === "already_completed") {
        finished += 1;
        jobLog("reconcile-dropbox", "upload finished", { jobId: job.id, outcome: result.outcome });
      }
    } catch (err) {
      jobLogError("reconcile-dropbox", "failed", {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return finished;
}
