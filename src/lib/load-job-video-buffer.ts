import { prisma } from "@/lib/prisma";
import { getObjectBody, pendingJobVideoKey } from "@/lib/s3";

/** True when the job still has a Runway video we can upload (S3 pending cache or stored URI / task). */
export async function hasRecoverableJobVideo(jobId: string): Promise<boolean> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      userId: true,
      runwayOutputVideoUri: true,
      providerOperationId: true,
    },
  });
  if (!job) return false;
  if (await getObjectBody(pendingJobVideoKey(job.userId, jobId))) return true;
  if (job.runwayOutputVideoUri) return true;
  if (job.providerOperationId) return true;
  return false;
}
