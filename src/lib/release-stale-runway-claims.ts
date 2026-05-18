/**
 * Queued jobs keep a rate-limit claim while processJob runs (download / submit).
 * If a workflow step times out or dies, the claim can block all 3 Runway slots for 15m.
 */

import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { jobLog } from "@/lib/job-log";

/** Release claims when a queued job has not reached Runway within this time. */
export const STALE_RUNWAY_CLAIM_MS = 8 * 60 * 1000;

export async function releaseStaleRunwayClaims(opts?: {
  userId?: string;
}): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_RUNWAY_CLAIM_MS);

  const result = await prisma.job.updateMany({
    where: {
      ...(opts?.userId ? { userId: opts.userId } : {}),
      status: JOB_STATUS.QUEUED,
      providerOperationId: null,
      rateLimitClaimedAt: { not: null, lt: staleBefore },
    },
    data: {
      rateLimitClaimedAt: null,
      workflowPhase: null,
    },
  });

  if (result.count > 0) {
    jobLog("release-claim", "cleared stale Runway rate-limit claims", {
      count: result.count,
      staleBeforeMs: STALE_RUNWAY_CLAIM_MS,
      userId: opts?.userId ?? null,
    });
  }

  return result.count;
}
