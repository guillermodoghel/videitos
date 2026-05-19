import { prisma } from "@/lib/prisma";
import { ensureDropboxPath } from "@/lib/dropbox-path";

/** Last 8 alphanumeric chars of a provider operation / task id (stable per generation). */
export function dropboxOutputUidSuffix(
  providerOperationId: string | null | undefined
): string | null {
  if (!providerOperationId) return null;
  const compact = providerOperationId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (compact.length < 4) return null;
  return compact.slice(-8);
}

export function buildSuffixedDropboxOutputFileName(
  sanitizedBaseName: string,
  jobId: string,
  providerOperationId?: string | null
): string {
  const jobIdSuffix = jobId.slice(-8);
  const base = `${sanitizedBaseName}-videitos-${jobIdSuffix}`;
  const uidSuffix =
    dropboxOutputUidSuffix(providerOperationId) ??
    Date.now().toString(36).slice(-8);
  return `${base}_${uidSuffix}.mp4`;
}

/**
 * Dropbox output filename for a job. After a retake, archived outputs exist and the new
 * upload gets a `_{uidSuffix}` so it does not collide with the previous file in Dropbox.
 */
export type JobOutputDropboxFileName = {
  fileName: string;
  isAdditionalTake: boolean;
};

export async function buildJobOutputDropboxFileName(
  jobId: string,
  sanitizedBaseName: string,
  providerOperationId?: string | null
): Promise<JobOutputDropboxFileName> {
  const archivedCount = await prisma.jobOutput.count({ where: { jobId } });
  const seed = providerOperationId ?? jobId;

  return {
    fileName: buildSuffixedDropboxOutputFileName(sanitizedBaseName, jobId, seed),
    isAdditionalTake: archivedCount > 0,
  };
}

export function joinDropboxDestinationPath(destPath: string, fileName: string): string {
  const base = ensureDropboxPath(destPath).replace(/\/$/, "");
  const name = fileName.replace(/^\//, "");
  return `${base}/${name}`;
}
