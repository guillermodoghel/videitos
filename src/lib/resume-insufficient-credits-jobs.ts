import { prisma } from "@/lib/prisma";
import { startJobWorkflow } from "@/lib/start-job-workflow";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { INSUFFICIENT_CREDITS_ERROR_MESSAGES } from "@/lib/constants/job-error-messages";

const HOSTNAME = process.env.HOSTNAME ?? "http://localhost:3000";

/**
 * Re-queue and start workflow for all failed jobs (Insufficient credits) for this user.
 * Call after granting credits (Stripe webhook, admin grant, etc.) so those jobs can run.
 */
export async function resumeInsufficientCreditsJobs(userId: string): Promise<number> {
  const jobs = await prisma.job.findMany({
    where: {
      userId,
      status: JOB_STATUS.FAILED,
      errorMessage: { in: [...INSUFFICIENT_CREDITS_ERROR_MESSAGES] },
    },
    select: { id: true },
  });
  const baseUrl = HOSTNAME.replace(/\/$/, "");
  for (const job of jobs) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.QUEUED,
        errorMessage: null,
        completedAt: null,
        providerOperationId: null,
        sentAt: null,
        rateLimitClaimedAt: null,
      },
    });
    startJobWorkflow({ jobId: job.id, callbackBaseUrl: baseUrl }).catch((err) =>
      console.error("[resumeInsufficientCreditsJobs] startJobWorkflow failed for job=%s", job.id, err)
    );
  }
  return jobs.length;
}
