import { prisma } from "@/lib/prisma";
import { RUNWAY_TASK_STATUS } from "@/lib/constants/runway-task-status";
import { normalizeRunwayProgress } from "@/lib/runway-progress-display";

/** Store latest Runway poll result for the jobs dashboard. */
export async function persistRunwayPollStatus(
  jobId: string,
  data: { progress?: number; runwayStatus?: string }
): Promise<void> {
  const update: { runwayProgress?: number | null; runwayPollStatus?: string | null } = {};
  const runwayStatus = data.runwayStatus?.toUpperCase();
  if (runwayStatus !== undefined) {
    update.runwayPollStatus = runwayStatus;
  }
  if (runwayStatus === RUNWAY_TASK_STATUS.RUNNING && data.progress !== undefined) {
    update.runwayProgress = normalizeRunwayProgress(data.progress, runwayStatus);
  }
  // PENDING / THROTTLED: keep last RUNNING progress in DB for the dashboard between polls.
  if (Object.keys(update).length === 0) return;

  await prisma.job.update({
    where: { id: jobId },
    data: update,
  });
}

export async function clearRunwayPollStatus(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { runwayProgress: null, runwayPollStatus: null },
  });
}
