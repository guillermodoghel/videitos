import { prisma } from "@/lib/prisma";
import { jobLog } from "@/lib/job-log";

/** Save Runway output URL so Dropbox upload can be retried without re-generating. */
export async function persistRunwayVideoUri(
  jobId: string,
  videoUri: string
): Promise<void> {
  if (!videoUri.startsWith("http")) return;

  await prisma.job.updateMany({
    where: { id: jobId },
    data: { runwayOutputVideoUri: videoUri },
  });

  let host: string | null = null;
  try {
    host = new URL(videoUri).hostname;
  } catch {
    host = null;
  }

  jobLog("runway-uri", "stored output video URI", {
    jobId,
    videoUriHost: host,
    videoUriLength: videoUri.length,
  });
}
