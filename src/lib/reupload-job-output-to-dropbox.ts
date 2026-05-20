import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import {
  JOB_ERROR,
  truncateDropboxUploadErrorDetail,
} from "@/lib/constants/job-error-messages";
import { downloadFile, getValidAccessToken, getValidAccessTokenWithOptions } from "@/lib/dropbox";
import { uploadFileToDropbox } from "@/lib/dropbox-upload";
import { isDropboxRateLimitError } from "@/lib/dropbox-rate-limit";
import { sanitizeOutputFileBaseName } from "@/lib/discover-job-output-dropbox-paths";
import { jobLog, jobLogError } from "@/lib/job-log";
import { uploadJobOutputToDropbox } from "@/lib/upload-job-output-to-dropbox";
import { downloadRunwayVideo } from "@/lib/runway";
import { getRunwayApiKeyForUser } from "@/lib/runway-api-key";
import { resolveRunwayVideoUriForJob } from "@/lib/resolve-runway-video-uri";
import {
  getObjectBody,
  jobOutputVideoKey,
  pendingJobVideoKey,
} from "@/lib/s3";

export type ReuploadJobOutputToDropboxResult =
  | { ok: true; outputDropboxPath: string; version: number }
  | {
      ok: false;
      error: string;
      status: number;
      retryAfterSeconds?: number;
    };

async function loadArchivedOutputBuffer(
  userId: string,
  archived: {
    outputVideoS3Key: string | null;
    outputDropboxPath: string | null;
    jobId: string;
  }
): Promise<Buffer | null> {
  if (archived.outputVideoS3Key) {
    const buf = await getObjectBody(archived.outputVideoS3Key);
    if (buf) return buf;
  }
  if (archived.outputDropboxPath) {
    const token = await getValidAccessToken(userId);
    if (token) {
      return downloadFile(token, archived.outputDropboxPath, {
        logContext: { source: "reupload-output", jobId: archived.jobId },
      });
    }
  }
  return null;
}

async function loadCurrentOutputBuffer(job: {
  id: string;
  userId: string;
  outputDropboxPath: string | null;
  runwayOutputVideoUri: string | null;
  providerOperationId: string | null;
  user: { runwayApiKey: string | null };
}): Promise<Buffer | null> {
  const output = await getObjectBody(jobOutputVideoKey(job.userId, job.id));
  if (output) return output;

  const pending = await getObjectBody(pendingJobVideoKey(job.userId, job.id));
  if (pending) return pending;

  if (job.outputDropboxPath) {
    const token = await getValidAccessToken(job.userId);
    if (token) {
      const buf = await downloadFile(token, job.outputDropboxPath, {
        logContext: { source: "reupload-output", jobId: job.id },
      });
      if (buf) return buf;
    }
  }

  let videoUri = job.runwayOutputVideoUri;
  if (!videoUri && job.providerOperationId) {
    videoUri = await resolveRunwayVideoUriForJob(job.id);
  }
  if (videoUri) {
    const apiKey = await getRunwayApiKeyForUser(job.user.runwayApiKey);
    if (apiKey) {
      return downloadRunwayVideo(apiKey, videoUri, {
        logContext: { source: "reupload-output", jobId: job.id },
      });
    }
  }

  return null;
}

/**
 * Re-upload a specific job output version (or current take) to Dropbox from stored video bytes.
 */
export async function reuploadJobOutputToDropbox(
  jobId: string,
  opts: { userId: string; isAdmin?: boolean; version: number }
): Promise<ReuploadJobOutputToDropboxResult> {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      ...(opts.isAdmin ? {} : { userId: opts.userId }),
    },
    select: {
      id: true,
      userId: true,
      status: true,
      dropboxSourceFilePath: true,
      outputDropboxPath: true,
      providerOperationId: true,
      runwayOutputVideoUri: true,
      template: { select: { dropboxDestinationPath: true } },
      user: { select: { runwayApiKey: true } },
    },
  });

  if (!job) {
    return { ok: false, error: "Job not found", status: 404 };
  }

  const destPath = job.template.dropboxDestinationPath?.trim();
  if (!destPath) {
    return { ok: false, error: "Template has no Dropbox destination folder", status: 400 };
  }

  const archived = await prisma.jobOutput.findUnique({
    where: { jobId_version: { jobId, version: opts.version } },
    select: {
      version: true,
      outputVideoS3Key: true,
      outputDropboxPath: true,
      providerOperationId: true,
    },
  });

  const agg = await prisma.jobOutput.aggregate({
    where: { jobId },
    _max: { version: true },
  });
  const currentVersion =
    (agg._max.version ?? 0) > 0 ? (agg._max.version ?? 0) + 1 : 1;
  const isCurrentTake = !archived && opts.version === currentVersion;

  if (!archived && !isCurrentTake) {
    return { ok: false, error: "Output version not found", status: 404 };
  }

  const videoBuffer = archived
    ? await loadArchivedOutputBuffer(job.userId, { ...archived, jobId })
    : await loadCurrentOutputBuffer({ ...job, user: job.user });

  if (!videoBuffer) {
    return {
      ok: false,
      error: "Could not load video for this take (no S3 copy or Dropbox file)",
      status: 400,
    };
  }

  const token = await getValidAccessToken(job.userId);
  if (!token) {
    return { ok: false, error: JOB_ERROR.DROPBOX_NOT_CONNECTED, status: 400 };
  }

  const existingPath = archived?.outputDropboxPath ?? (isCurrentTake ? job.outputDropboxPath : null);
  const rawBaseName = job.dropboxSourceFilePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "video";
  const baseName = sanitizeOutputFileBaseName(rawBaseName);
  const operationId = archived?.providerOperationId ?? job.providerOperationId;

  jobLog("reupload-output", "starting Dropbox re-upload", {
    jobId,
    version: opts.version,
    isCurrentTake,
    hasExistingPath: !!existingPath,
    bytes: videoBuffer.byteLength,
  });

  let outputPath: string | undefined;

  try {
    if (existingPath) {
      const uploadResult = await uploadFileToDropbox(token, existingPath, videoBuffer, {
        mode: "overwrite",
        onUnauthorized: () => getValidAccessTokenWithOptions(job.userId, { forceRefresh: true }),
        logContext: { source: "reupload-output", jobId, version: opts.version },
      });
      if (!uploadResult.ok) {
        const detail = truncateDropboxUploadErrorDetail(uploadResult.reason);
        jobLogError("reupload-output", "Dropbox overwrite failed", {
          jobId,
          version: opts.version,
          reason: uploadResult.reason,
        });
        return {
          ok: false,
          error: detail ?? JOB_ERROR.DROPBOX_UPLOAD_FAILED,
          status: uploadResult.status === 429 ? 429 : 500,
        };
      }
      outputPath = uploadResult.path_display ?? existingPath;
    } else {
      const uploadResult = await uploadJobOutputToDropbox({
        token,
        destPath,
        baseName,
        jobId: job.id,
        operationId,
        videoBuffer,
        onUnauthorized: () => getValidAccessTokenWithOptions(job.userId, { forceRefresh: true }),
        logContext: { source: "reupload-output", jobId, version: opts.version },
      });
      if (!uploadResult.ok) {
        const detail = truncateDropboxUploadErrorDetail(uploadResult.reason);
        jobLogError("reupload-output", "Dropbox upload failed", {
          jobId,
          version: opts.version,
          reason: uploadResult.reason,
        });
        return {
          ok: false,
          error: detail ?? JOB_ERROR.DROPBOX_UPLOAD_FAILED,
          status: uploadResult.status === 429 ? 429 : 500,
        };
      }
      outputPath = uploadResult.path_display ?? uploadResult.outputPath;
    }
  } catch (err) {
    if (isDropboxRateLimitError(err)) {
      return {
        ok: false,
        error: `Dropbox rate limited. Try again in about ${err.retryAfterSeconds} seconds.`,
        status: 429,
        retryAfterSeconds: err.retryAfterSeconds,
      };
    }
    throw err;
  }

  if (!outputPath) {
    return { ok: false, error: "Upload succeeded but no Dropbox path returned", status: 500 };
  }

  if (archived) {
    await prisma.jobOutput.update({
      where: { jobId_version: { jobId, version: opts.version } },
      data: { outputDropboxPath: outputPath },
    });
  } else if (isCurrentTake) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        outputDropboxPath: outputPath,
        ...(job.status === JOB_STATUS.FAILED
          ? {
              status: JOB_STATUS.COMPLETED,
              errorMessage: null,
              dropboxUploadErrorDetail: null,
              completedAt: new Date(),
            }
          : {}),
      },
    });
  }

  jobLog("reupload-output", "Dropbox re-upload succeeded", {
    jobId,
    version: opts.version,
    outputDropboxPath: outputPath,
  });

  return { ok: true, outputDropboxPath: outputPath, version: opts.version };
}
