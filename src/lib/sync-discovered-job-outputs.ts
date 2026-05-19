import { prisma } from "@/lib/prisma";
import { discoverJobOutputDropboxPaths } from "@/lib/discover-job-output-dropbox-paths";
import { jobLog } from "@/lib/job-log";

/**
 * Persist JobOutput rows for Dropbox files that match this job but were never archived
 * (legacy retakes / failed uploads before JobOutput existed).
 */
export async function syncDiscoveredOutputsToJobOutput(jobId: string): Promise<number> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      dropboxSourceFilePath: true,
      outputDropboxPath: true,
      template: { select: { dropboxDestinationPath: true } },
    },
  });

  if (!job?.template?.dropboxDestinationPath) return 0;

  const discovered = await discoverJobOutputDropboxPaths({
    userId: job.userId,
    jobId: job.id,
    dropboxSourceFilePath: job.dropboxSourceFilePath,
    dropboxDestinationPath: job.template.dropboxDestinationPath,
  });

  if (discovered.length === 0) return 0;

  const existing = await prisma.jobOutput.findMany({
    where: { jobId: job.id },
    select: { outputDropboxPath: true, version: true },
  });

  const knownPaths = new Set(
    [
      ...existing.map((o) => o.outputDropboxPath).filter(Boolean),
      job.outputDropboxPath,
    ].filter((p): p is string => !!p)
  );

  const toCreate = discovered.filter(
    (d) =>
      !knownPaths.has(d.outputDropboxPath) &&
      d.outputDropboxPath !== job.outputDropboxPath
  );
  if (toCreate.length === 0) return 0;

  let version = existing.reduce((max, o) => Math.max(max, o.version), 0);
  let created = 0;

  for (const item of toCreate) {
    version += 1;
    await prisma.jobOutput.create({
      data: {
        jobId: job.id,
        version,
        outputDropboxPath: item.outputDropboxPath,
        outputVideoS3Key: null,
        providerOperationId: null,
        preGenImageKey: null,
        apiCost: null,
        creditCost: null,
        completedAt: item.completedAt ?? new Date(),
      },
    });
    created += 1;
  }

  jobLog("sync-discovered-outputs", "backfilled JobOutput from Dropbox", {
    jobId,
    created,
  });

  return created;
}
