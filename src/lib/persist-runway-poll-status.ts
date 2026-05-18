import { prisma } from "@/lib/prisma";
import { normalizeRunwayProgress } from "@/lib/runway-progress-display";

/** Store latest Runway poll result for the jobs dashboard. */
export async function persistRunwayPollStatus(
  jobId: string,
  data: { progress?: number; runwayStatus?: string }
): Promise<void> {
  const update: { runwayProgress?: number | null; runwayPollStatus?: string | null } = {};
  if (data.progress !== undefined) {
    update.runwayProgress = normalizeRunwayProgress(data.progress);
  }
  if (data.runwayStatus !== undefined) {
    update.runwayPollStatus = data.runwayStatus;
  }
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
