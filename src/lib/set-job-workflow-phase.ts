import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import type { JobWorkflowPhase } from "@/lib/constants/job-workflow-phase";
import { jobLog } from "@/lib/job-log";

const ACTIVE_STATUSES = [
  JOB_STATUS.QUEUED,
  JOB_STATUS.PROCESSING,
  JOB_STATUS.SENT_TO_VEO,
] as const;

/** Update workflow phase for dashboard / debugging; no-op if job is no longer active. */
export async function setJobWorkflowPhase(
  jobId: string,
  phase: JobWorkflowPhase | null
): Promise<void> {
  const updated = await prisma.job.updateMany({
    where: {
      id: jobId,
      status: { in: [...ACTIVE_STATUSES] },
    },
    data: { workflowPhase: phase },
  });
  if (updated.count > 0) {
    jobLog("workflow:phase", phase ?? "cleared", { jobId, phase });
  }
}
