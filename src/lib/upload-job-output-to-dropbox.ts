/**
 * Upload a job output video to Dropbox with a unique path per attempt.
 * On path/conflict (409), rerolls the filename and retries (never overwrites a sibling take).
 */

import { randomBytes } from "crypto";
import { uploadFileToDropbox, type DropboxUploadResult } from "@/lib/dropbox-upload";
import {
  buildSuffixedDropboxOutputFileName,
  joinDropboxDestinationPath,
} from "@/lib/job-output-dropbox-path";
import { jobLog } from "@/lib/job-log";

const MAX_PATH_ATTEMPTS = 5;

export function isDropboxPathConflictResult(result: {
  ok: boolean;
  status?: number;
  reason?: string;
}): boolean {
  if (result.ok) return false;
  if (result.status === 409) return true;
  return typeof result.reason === "string" && result.reason.includes("path/conflict");
}

/** Seeds for Dropbox filenames — stable first, then rerolls on conflict. */
export function buildDropboxOutputPathSeeds(
  operationId: string | null | undefined,
  jobId: string
): string[] {
  const seeds: string[] = [];
  if (operationId) seeds.push(operationId);
  seeds.push(`${operationId ?? jobId}-t${Date.now().toString(36)}`);
  while (seeds.length < MAX_PATH_ATTEMPTS) {
    seeds.push(`${operationId ?? jobId}-r${randomBytes(4).toString("hex")}`);
  }
  return seeds.slice(0, MAX_PATH_ATTEMPTS);
}

export type UploadJobOutputToDropboxResult = DropboxUploadResult & {
  outputPath?: string;
  fileName?: string;
};

export async function uploadJobOutputToDropbox(params: {
  token: string;
  destPath: string;
  baseName: string;
  jobId: string;
  operationId: string | null | undefined;
  videoBuffer: Buffer;
  onUnauthorized: () => Promise<string | null>;
  logContext: Record<string, unknown>;
}): Promise<UploadJobOutputToDropboxResult> {
  const seeds = buildDropboxOutputPathSeeds(params.operationId, params.jobId);
  let lastResult: DropboxUploadResult = { ok: false, reason: "no upload attempt" };
  let token = params.token;

  for (let attempt = 0; attempt < seeds.length; attempt++) {
    const fileName = buildSuffixedDropboxOutputFileName(
      params.baseName,
      params.jobId,
      seeds[attempt]
    );
    const outputPath = joinDropboxDestinationPath(params.destPath, fileName);

    jobLog("dropbox-upload", "upload attempt", {
      ...params.logContext,
      pathAttempt: attempt + 1,
      maxAttempts: seeds.length,
      outputFileName: fileName,
      outputPath,
    });

    lastResult = await uploadFileToDropbox(token, outputPath, params.videoBuffer, {
      mode: "overwrite",
      onUnauthorized: async () => {
        const refreshed = await params.onUnauthorized();
        if (refreshed) token = refreshed;
        return refreshed;
      },
      logContext: {
        ...params.logContext,
        pathAttempt: attempt + 1,
        outputFileName: fileName,
        outputPath,
      },
    });

    if (lastResult.ok) {
      return {
        ...lastResult,
        outputPath: lastResult.path_display ?? outputPath,
        fileName,
      };
    }

    if (!isDropboxPathConflictResult(lastResult)) {
      return lastResult;
    }

    jobLog("dropbox-upload", "path conflict — rerolling output filename", {
      ...params.logContext,
      pathAttempt: attempt + 1,
      outputPath,
      reason: lastResult.reason,
    });
  }

  return lastResult;
}
