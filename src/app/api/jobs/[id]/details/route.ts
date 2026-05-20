import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPresignedUrl, getPresignedUrlIfExists, isS3Key, pendingJobVideoKey } from "@/lib/s3";
import { USER_ROLE } from "@/lib/constants/user-role";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { resolveJobOutputVideoUrl } from "@/lib/job-output-video-url";
import { syncDiscoveredOutputsToJobOutput } from "@/lib/sync-discovered-job-outputs";
import { parseTemplateConfig } from "@/lib/video-models";
import { hasRecoverableJobVideo } from "@/lib/load-job-video-buffer";
import { getObjectBody } from "@/lib/s3";

export type JobOutputHistoryEntry = {
  version: number;
  isCurrent: boolean;
  completedAt: string;
  creditCost: number | null;
  outputVideoUrl: string | null;
  outputDropboxPath: string | null;
  canReuploadDropbox: boolean;
};

/**
 * GET /api/jobs/[id]/details
 * Returns preview URLs for a job: reference images (S3), source thumbnail (S3), output video (S3, Dropbox fallback).
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
      template: {
        select: { config: true, dropboxDestinationPath: true, model: true },
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (job.template.dropboxDestinationPath) {
    try {
      await syncDiscoveredOutputsToJobOutput(job.id);
    } catch {
      // JobOutput table may be missing until migrations are applied
    }
  }

  let archivedOutputs: Awaited<ReturnType<typeof prisma.jobOutput.findMany>> = [];
  try {
    archivedOutputs = await prisma.jobOutput.findMany({
      where: { jobId: job.id },
      orderBy: { completedAt: "asc" },
    });
  } catch {
    // JobOutput table may be missing until migrations are applied
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

  let outputVideoUrl: string | null = null;
  if (job.status === JOB_STATUS.COMPLETED && job.outputDropboxPath) {
    outputVideoUrl = await resolveJobOutputVideoUrl(job.userId, {
      jobId: job.id,
      outputDropboxPath: job.outputDropboxPath,
    });
  }

  const outputHistory: JobOutputHistoryEntry[] = [];
  const recoverableCurrentVideo = await hasRecoverableJobVideo(job.id);

  for (const archived of archivedOutputs) {
    const url = await resolveJobOutputVideoUrl(job.userId, {
      outputVideoS3Key: archived.outputVideoS3Key,
      outputDropboxPath: archived.outputDropboxPath,
    });
    const hasS3 =
      !!archived.outputVideoS3Key &&
      !!(await getObjectBody(archived.outputVideoS3Key));
    outputHistory.push({
      version: archived.version,
      isCurrent: false,
      completedAt: archived.completedAt.toISOString(),
      creditCost: archived.creditCost != null ? Number(archived.creditCost) : null,
      outputVideoUrl: url,
      outputDropboxPath: archived.outputDropboxPath,
      canReuploadDropbox: hasS3 || !!archived.outputDropboxPath || !!url,
    });
  }

  if (job.status === JOB_STATUS.COMPLETED && (job.outputDropboxPath || outputVideoUrl)) {
    const currentVersion =
      archivedOutputs.length > 0
        ? Math.max(...archivedOutputs.map((o) => o.version)) + 1
        : 1;
    outputHistory.push({
      version: currentVersion,
      isCurrent: true,
      completedAt: (job.completedAt ?? job.updatedAt).toISOString(),
      creditCost: job.creditCost != null ? Number(job.creditCost) : null,
      outputVideoUrl,
      outputDropboxPath: job.outputDropboxPath,
      canReuploadDropbox: !!outputVideoUrl || recoverableCurrentVideo,
    });
  } else if (archivedOutputs.length > 0 || job.status !== JOB_STATUS.COMPLETED) {
    const pendingUrl = await getPresignedUrlIfExists(
      pendingJobVideoKey(job.userId, job.id)
    );
    if (pendingUrl) {
      const currentVersion =
        archivedOutputs.length > 0
          ? Math.max(...archivedOutputs.map((o) => o.version)) + 1
          : 1;
      outputHistory.push({
        version: currentVersion,
        isCurrent: true,
        completedAt: job.updatedAt.toISOString(),
        creditCost: null,
        outputVideoUrl: pendingUrl,
        outputDropboxPath: job.outputDropboxPath,
        canReuploadDropbox: true,
      });
    }
  }

  outputHistory.sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );

  const templatePrompt = parseTemplateConfig(
    job.template.model,
    job.template.config
  ).prompt;

  return NextResponse.json({
    referenceImageUrls,
    preGenImageUrl,
    outputVideoUrl,
    outputHistory,
    templatePrompt,
  });
}
