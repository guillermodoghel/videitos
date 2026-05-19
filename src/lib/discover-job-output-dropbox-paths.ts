import { getValidAccessToken, listFolder } from "@/lib/dropbox";
import { ensureDropboxPath } from "@/lib/dropbox-path";
import { jobLog } from "@/lib/job-log";

export type DiscoveredJobOutput = {
  outputDropboxPath: string;
  fileName: string;
  completedAt: Date | null;
};

export function sanitizeOutputFileBaseName(input: string): string {
  const normalized = input.normalize("NFKC");
  const cleaned = normalized
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/:"*<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "video";
}

/** Matches `{base}-videitos-{jobId8}.mp4` and `{base}-videitos-{jobId8}_{suffix}.mp4`. */
export function jobOutputDropboxFilePattern(
  sanitizedBaseName: string,
  jobId: string
): RegExp {
  const jobIdSuffix = jobId.slice(-8);
  const escaped = sanitizedBaseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}-videitos-${jobIdSuffix}(?:_[a-z0-9]+)?\\.mp4$`, "i");
}

type DropboxListEntry = {
  [".tag"]?: string;
  name?: string;
  path_display?: string;
  client_modified?: string;
};

/**
 * Find all output videos for this job in the template Dropbox folder (includes legacy
 * uploads that were never written to JobOutput).
 */
export async function discoverJobOutputDropboxPaths(params: {
  userId: string;
  jobId: string;
  dropboxSourceFilePath: string;
  dropboxDestinationPath: string;
}): Promise<DiscoveredJobOutput[]> {
  const token = await getValidAccessToken(params.userId);
  if (!token) return [];

  const destFolder = ensureDropboxPath(params.dropboxDestinationPath).replace(/\/$/, "");
  const rawBaseName =
    params.dropboxSourceFilePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "video";
  const baseName = sanitizeOutputFileBaseName(rawBaseName);
  const pattern = jobOutputDropboxFilePattern(baseName, params.jobId);

  let entries: DropboxListEntry[];
  try {
    const listed = await listFolder(token, destFolder);
    entries = listed.entries as DropboxListEntry[];
  } catch (err) {
    jobLog("discover-outputs", "list_folder failed", {
      jobId: params.jobId,
      destFolder,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const matches: DiscoveredJobOutput[] = [];
  for (const entry of entries) {
    if (entry[".tag"] !== "file") continue;
    const name = entry.name ?? "";
    if (!pattern.test(name)) continue;
    const path = entry.path_display ?? `${destFolder}/${name}`;
    let completedAt: Date | null = null;
    if (entry.client_modified) {
      const parsed = new Date(entry.client_modified);
      if (!Number.isNaN(parsed.getTime())) completedAt = parsed;
    }
    matches.push({ outputDropboxPath: path, fileName: name, completedAt });
  }

  matches.sort((a, b) => {
    const ta = a.completedAt?.getTime() ?? 0;
    const tb = b.completedAt?.getTime() ?? 0;
    return ta - tb || a.fileName.localeCompare(b.fileName);
  });

  jobLog("discover-outputs", "found Dropbox outputs for job", {
    jobId: params.jobId,
    count: matches.length,
    destFolder,
  });

  return matches;
}
