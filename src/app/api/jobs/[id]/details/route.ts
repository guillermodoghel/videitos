import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getTemporaryLink } from "@/lib/dropbox";
import { getPresignedUrl, isS3Key } from "@/lib/s3";
import { USER_ROLE } from "@/lib/constants/user-role";

/**
 * GET /api/jobs/[id]/details
 * Returns preview URLs for a job: reference images (S3), source image (Dropbox), output video (Dropbox when completed).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = sessionUser.role === USER_ROLE.ADMIN;

  const { id } = await params;
  const job = await prisma.job.findFirst({
    where: {
      id,
      ...(isAdmin ? {} : { userId: sessionUser.id }),
    },
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
    if (!key.startsWith(job.userId + "/")) continue;
    const url = await getPresignedUrl(key);
    if (url) referenceImageUrls.push(url);
  }

  let preGenImageUrl: string | null = null;
  if (job.preGenImageKey && job.preGenImageKey.startsWith(job.userId + "/")) {
    const url = await getPresignedUrl(job.preGenImageKey);
    if (url) preGenImageUrl = url;
  }

  let sourceImageUrl: string | null = null;
  let outputVideoUrl: string | null = null;
  const token = await getValidAccessToken(job.userId);
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
