import { prisma } from "@/lib/prisma";
import { jobLog, jobLogError } from "@/lib/job-log";
import { getValidAccessToken, downloadFile } from "@/lib/dropbox";
import { downloadRunwayVideo } from "@/lib/runway";
import { getRunwayApiKeyForUser } from "@/lib/runway-api-key";
import {
  getObjectBody,
  pendingJobVideoKey,
  uploadJobOutputHistoryVideo,
} from "@/lib/s3";
import { resolveRunwayVideoUriForJob } from "@/lib/resolve-runway-video-uri";

/**
 * Snapshot the current completed output before retake (Dropbox path + optional S3 copy).
 */
export async function archiveJobOutputHistory(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      status: true,
      outputDropboxPath: true,
      runwayOutputVideoUri: true,
      providerOperationId: true,
      preGenImageKey: true,
      apiCost: true,
      creditCost: true,
      completedAt: true,
      user: { select: { runwayApiKey: true } },
    },
  });

  if (!job) return;

  const hasOutput =
    !!job.outputDropboxPath ||
    !!job.runwayOutputVideoUri ||
    !!(await getObjectBody(pendingJobVideoKey(job.userId, job.id)));

  if (!hasOutput) {
    jobLog("archive-output", "nothing to archive", { jobId });
    return;
  }

  const agg = await prisma.jobOutput.aggregate({
    where: { jobId },
    _max: { version: true },
  });
  const version = (agg._max.version ?? 0) + 1;

  let outputVideoS3Key: string | null = null;
  const buffer = await loadOutputVideoBuffer(job);
  if (buffer) {
    outputVideoS3Key = await uploadJobOutputHistoryVideo(job.userId, job.id, version, buffer);
    if (!outputVideoS3Key) {
      jobLog("archive-output", "S3 upload skipped (not configured)", { jobId, version });
    }
  }

  await prisma.jobOutput.create({
    data: {
      jobId: job.id,
      version,
      outputDropboxPath: job.outputDropboxPath,
      outputVideoS3Key,
      providerOperationId: job.providerOperationId,
      preGenImageKey: job.preGenImageKey,
      apiCost: job.apiCost,
      creditCost: job.creditCost,
      completedAt: job.completedAt ?? new Date(),
    },
  });

  jobLog("archive-output", "archived previous output", {
    jobId,
    version,
    hasS3: !!outputVideoS3Key,
    hasDropbox: !!job.outputDropboxPath,
  });
}

async function loadOutputVideoBuffer(job: {
  id: string;
  userId: string;
  outputDropboxPath: string | null;
  runwayOutputVideoUri: string | null;
  providerOperationId: string | null;
  user: { runwayApiKey: string | null };
}): Promise<Buffer | null> {
  const pending = await getObjectBody(pendingJobVideoKey(job.userId, job.id));
  if (pending) return pending;

  if (job.outputDropboxPath) {
    const token = await getValidAccessToken(job.userId);
    if (token) {
      const buf = await downloadFile(token, job.outputDropboxPath, {
        logContext: { source: "archive-output", jobId: job.id },
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
      const buf = await downloadRunwayVideo(apiKey, videoUri, {
        logContext: { source: "archive-output", jobId: job.id },
      });
      if (buf) return buf;
    }
  }

  jobLogError("archive-output", "could not load video bytes for S3 archive", {
    jobId: job.id,
    hasDropbox: !!job.outputDropboxPath,
    hasRunwayUri: !!job.runwayOutputVideoUri,
  });
  return null;
}
