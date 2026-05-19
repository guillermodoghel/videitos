import { downloadFile, getTemporaryLink, getValidAccessToken } from "@/lib/dropbox";
import {
  copyS3Object,
  getObjectBody,
  getPresignedUrlIfExists,
  isS3Key,
  jobOutputVideoKey,
  pendingJobVideoKey,
  s3ObjectExists,
  uploadJobOutputVideo,
} from "@/lib/s3";

/**
 * Ensure the job's output video is in S3 and return a presigned URL.
 * Prefers permanent output key, then pending cache, then one-time Dropbox download → S3.
 */
export async function ensureJobOutputVideoInS3(params: {
  userId: string;
  jobId: string;
  outputDropboxPath?: string | null;
}): Promise<string | null> {
  const { userId, jobId, outputDropboxPath } = params;
  const outputKey = jobOutputVideoKey(userId, jobId);

  const existing = await getPresignedUrlIfExists(outputKey);
  if (existing) return existing;

  const pendingKey = pendingJobVideoKey(userId, jobId);
  if (await s3ObjectExists(pendingKey)) {
    if (await copyS3Object(pendingKey, outputKey)) {
      return getPresignedUrlIfExists(outputKey);
    }
    const pendingBody = await getObjectBody(pendingKey);
    if (pendingBody) {
      await uploadJobOutputVideo(userId, jobId, pendingBody);
      return getPresignedUrlIfExists(outputKey);
    }
  }

  if (outputDropboxPath) {
    const token = await getValidAccessToken(userId);
    if (token) {
      const buffer = await downloadFile(token, outputDropboxPath, {
        logContext: { source: "ensure-output-s3", jobId },
      });
      if (buffer) {
        await uploadJobOutputVideo(userId, jobId, buffer);
        return getPresignedUrlIfExists(outputKey);
      }
    }
  }

  return null;
}

/** Resolve a playable URL for an archived or current job output (S3 first, Dropbox last). */
export async function resolveJobOutputVideoUrl(
  userId: string,
  output: {
    jobId?: string;
    outputVideoS3Key?: string | null;
    outputDropboxPath?: string | null;
  }
): Promise<string | null> {
  // Per-take history key (archived outputs) — must come before job output.mp4 lookup.
  const historyKey = output.outputVideoS3Key;
  if (historyKey && isS3Key(historyKey) && historyKey.startsWith(`${userId}/`)) {
    const url = await getPresignedUrlIfExists(historyKey);
    if (url) return url;
  }

  const dropboxPath = output.outputDropboxPath;
  if (dropboxPath) {
    const token = await getValidAccessToken(userId);
    if (token) {
      const link = await getTemporaryLink(token, dropboxPath);
      if (link) return link.link;
    }
  }

  // Current take: cache under jobs/{jobId}/output.mp4 for dashboard playback.
  if (output.jobId) {
    return ensureJobOutputVideoInS3({
      userId,
      jobId: output.jobId,
      outputDropboxPath: dropboxPath,
    });
  }

  return null;
}
