import { prisma } from "@/lib/prisma";

/**
 * Dropbox output filename for a job. After a retake, archived outputs get a version suffix
 * so the new upload does not collide with the previous file in the destination folder.
 */
export async function buildJobOutputDropboxFileName(
  jobId: string,
  sanitizedBaseName: string
): Promise<string> {
  const archivedCount = await prisma.jobOutput.count({ where: { jobId } });
  const versionSuffix = archivedCount > 0 ? `-v${archivedCount + 1}` : "";
  return `${sanitizedBaseName}-videitos-${jobId.slice(-8)}${versionSuffix}.mp4`;
}

export function joinDropboxDestinationPath(destPath: string, fileName: string): string {
  const normalized = destPath.replace(/\/$/, "");
  return `${normalized}/${fileName}`;
}
