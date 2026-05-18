import { prisma } from "@/lib/prisma";
import { jobLog } from "@/lib/job-log";

/** Save Runway output URL so Dropbox upload can be retried without re-generating. */
export async function persistRunwayVideoUri(
  jobId: string,
  videoUri: string
): Promise<void> {
  if (!videoUri.startsWith("http")) return;

  const updated = await prisma.job.updateMany({
    where: { id: jobId },
    data: {
      runwayOutputVideoUri: videoUri,
      rateLimitClaimedAt: null,
    },
  });

  let host: string | null = null;
  try {
    host = new URL(videoUri).hostname;
  } catch {
    host = null;
  }

  jobLog("runway-uri", "stored output video URI — Runway slot released", {
    jobId,
    videoUriHost: host,
    videoUriLength: videoUri.length,
    rowsUpdated: updated.count,
  });
}
