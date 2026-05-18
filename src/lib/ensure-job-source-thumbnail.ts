import { prisma } from "@/lib/prisma";
import { getValidAccessToken, downloadFile } from "@/lib/dropbox";
import { jobDropboxSourcePathOrId } from "@/lib/job-dropbox-source";
import {
  contentTypeForS3Key,
  getObjectBody,
  uploadJobSourceThumbnail,
} from "@/lib/s3";

type JobForThumbnail = {
  id: string;
  userId: string;
  sourceThumbnailKey: string | null;
  dropboxSourceFilePath: string;
  dropboxSourceFileId: string | null;
};

function guessContentType(buffer: Buffer, filePath: string): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return "image/gif";
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return "image/webp";
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export type CachedJobThumbnail = {
  key: string;
  contentType: string;
  buffer: Buffer;
};

/**
 * Returns the cached S3 thumbnail, downloading from Dropbox once on first request.
 */
export async function ensureJobSourceThumbnail(
  job: JobForThumbnail
): Promise<CachedJobThumbnail | null> {
  if (job.sourceThumbnailKey) {
    const cached = await getObjectBody(job.sourceThumbnailKey);
    if (cached) {
      return {
        key: job.sourceThumbnailKey,
        contentType: contentTypeForS3Key(job.sourceThumbnailKey),
        buffer: cached,
      };
    }
  }

  const token = await getValidAccessToken(job.userId);
  if (!token) return null;

  const buffer = await downloadFile(token, jobDropboxSourcePathOrId(job), {
    logContext: { jobId: job.id, purpose: "source_thumbnail" },
  });
  if (!buffer) return null;

  const fresh = await prisma.job.findUnique({
    where: { id: job.id },
    select: { sourceThumbnailKey: true },
  });
  if (fresh?.sourceThumbnailKey) {
    const raced = await getObjectBody(fresh.sourceThumbnailKey);
    if (raced) {
      return {
        key: fresh.sourceThumbnailKey,
        contentType: contentTypeForS3Key(fresh.sourceThumbnailKey),
        buffer: raced,
      };
    }
  }

  const contentType = guessContentType(buffer, job.dropboxSourceFilePath);
  const key = await uploadJobSourceThumbnail(job.userId, job.id, buffer, contentType);
  if (!key) return null;

  await prisma.job.update({
    where: { id: job.id },
    data: { sourceThumbnailKey: key },
  });

  return { key, contentType, buffer };
}
