import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getTemporaryLink } from "@/lib/dropbox";
import { getPresignedUrl, isS3Key } from "@/lib/s3";

/**
 * GET /api/jobs/[id]/details
 * Returns preview URLs for a job: reference images (S3), source image (Dropbox), output video (Dropbox when completed).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const job = await prisma.job.findFirst({
    where: { id, userId },
    include: {
      template: { select: { config: true } },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const config = job.template.config as { referenceImageUrls?: string[] } | null;
  const refKeys = Array.isArray(config?.referenceImageUrls)
    ? config.referenceImageUrls.filter((k): k is string => typeof k === "string" && isS3Key(k)).slice(0, 2)
    : [];

  const referenceImageUrls: string[] = [];
  for (const key of refKeys) {
    if (!key.startsWith(userId + "/")) continue;
    const url = await getPresignedUrl(key);
    if (url) referenceImageUrls.push(url);
  }

  let preGenImageUrl: string | null = null;
  if (job.preGenImageKey && job.preGenImageKey.startsWith(userId + "/")) {
    const url = await getPresignedUrl(job.preGenImageKey);
    if (url) preGenImageUrl = url;
  }

  let sourceImageUrl: string | null = null;
  let outputVideoUrl: string | null = null;
  const token = await getValidAccessToken(userId);
  if (token) {
    const sourcePathOrId = job.dropboxSourceFileId
      ? job.dropboxSourceFileId.startsWith("id:")
        ? job.dropboxSourceFileId
        : `id:${job.dropboxSourceFileId}`
      : job.dropboxSourceFilePath;
    const sourceLink = await getTemporaryLink(token, sourcePathOrId);
    if (sourceLink) sourceImageUrl = sourceLink.link;
    if (job.outputDropboxPath) {
      const videoLink = await getTemporaryLink(token, job.outputDropboxPath);
      if (videoLink) outputVideoUrl = videoLink.link;
    }
  }

  return NextResponse.json({
    referenceImageUrls,
    sourceImageUrl,
    preGenImageUrl,
    outputVideoUrl,
  });
}
