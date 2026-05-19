/**
 * Download a finished Runway video and mark the job completed (Dropbox upload + credits).
 * Shared by webhook/job and stuck-job reconciliation.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { downloadRunwayVideo } from "@/lib/runway";
import { isRunwayImageToVideoModel, parseTemplateConfig } from "@/lib/video-models";
import { computeJobCost } from "@/lib/credits";
import { getRunwayApiKeyForUser, usesPlatformKey } from "@/lib/runway-api-key";
import { getValidAccessToken, getValidAccessTokenWithOptions } from "@/lib/dropbox";
import { uploadJobOutputToDropbox } from "@/lib/upload-job-output-to-dropbox";
import { maybeAutoRecharge } from "@/lib/stripe";
import { JOB_STATUS } from "@/lib/constants/job-status";
import {
  formatDropboxUploadJobError,
  JOB_ERROR,
  truncateDropboxUploadErrorDetail,
} from "@/lib/constants/job-error-messages";
import { CREDIT_KIND } from "@/lib/constants/credit-transaction-kind";
import { JOB_WORKFLOW_PHASE } from "@/lib/constants/job-workflow-phase";
import { jobLog, jobLogError } from "@/lib/job-log";
import { isDropboxRateLimitError } from "@/lib/dropbox-rate-limit";
import {
  getObjectBody,
  uploadPendingJobVideo,
  deletePendingJobVideo,
  pendingJobVideoKey,
  jobOutputVideoKey,
  s3ObjectExists,
  copyS3Object,
  uploadJobOutputVideo,
} from "@/lib/s3";
import { persistRunwayVideoUri } from "@/lib/persist-runway-video-uri";
import { isDropboxUploadRetryError, resolveRunwayVideoUriForJob } from "@/lib/resolve-runway-video-uri";

export type CompleteJobWithRunwayVideoResult =
  | { outcome: "completed"; outputDropboxPath: string }
  | { outcome: "already_completed"; outputDropboxPath: string | null }
  | { outcome: "skipped"; reason: string }
  | { outcome: "dropbox_rate_limited"; retryAfterSeconds: number }
  | { outcome: "failed"; error: string };

type JobForReady = {
  id: string;
  userId: string;
  templateId: string;
  status: string;
  errorMessage: string | null;
  dropboxUploadErrorDetail: string | null;
  providerOperationId: string | null;
  outputDropboxPath: string | null;
  dropboxSourceFilePath: string;
  preGenImageKey: string | null;
};

const ACTIVE_STATUSES = [
  JOB_STATUS.QUEUED,
  JOB_STATUS.PROCESSING,
  JOB_STATUS.SENT_TO_VEO,
] as const;

/** Whether we should run the ready pipeline for this job. */
export function getReadyCallbackDecision(
  job: JobForReady,
  operationName?: string | null
): { proceed: boolean; reason: string } {
  if (job.errorMessage === JOB_ERROR.CANCELED) {
    return { proceed: false, reason: "canceled" };
  }
  if (job.status === JOB_STATUS.COMPLETED) {
    return { proceed: false, reason: "already_completed" };
  }
  if (job.status === JOB_STATUS.FAILED) {
    if (isDropboxUploadRetryError(job.errorMessage, job.dropboxUploadErrorDetail)) {
      return { proceed: true, reason: "dropbox_retry" };
    }
    return { proceed: false, reason: "already_failed" };
  }
  if (!ACTIVE_STATUSES.includes(job.status as (typeof ACTIVE_STATUSES)[number])) {
    return { proceed: false, reason: `invalid_status:${job.status}` };
  }
  if (
    operationName &&
    job.providerOperationId &&
    job.providerOperationId !== operationName
  ) {
    return { proceed: false, reason: "stale_operation" };
  }
  return { proceed: true, reason: "ok" };
}

function sanitizeOutputFileBaseName(input: string): string {
  const normalized = input.normalize("NFKC");
  const cleaned = normalized
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/:"*<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "video";
}

export async function completeJobWithRunwayVideo(params: {
  jobId: string;
  videoUri?: string | null;
  operationName?: string | null;
  source?: string;
}): Promise<CompleteJobWithRunwayVideoResult> {
  const { jobId, videoUri: videoUriParam, operationName, source = "complete-job" } = params;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      templateId: true,
      status: true,
      errorMessage: true,
      dropboxUploadErrorDetail: true,
      providerOperationId: true,
      runwayOutputVideoUri: true,
      outputDropboxPath: true,
      dropboxSourceFilePath: true,
      preGenImageKey: true,
    },
  });

  if (!job) {
    return { outcome: "failed", error: "Job not found" };
  }

  let videoUri = videoUriParam ?? job.runwayOutputVideoUri;

  const decision = getReadyCallbackDecision(job, operationName);
  if (!decision.proceed) {
    jobLog("complete", "ready callback skipped", {
      jobId,
      reason: decision.reason,
      status: job.status,
      providerOperationId: job.providerOperationId,
      operationName: operationName ?? null,
      source,
    });
    if (decision.reason === "already_completed") {
      return { outcome: "already_completed", outputDropboxPath: job.outputDropboxPath };
    }
    return { outcome: "skipped", reason: decision.reason };
  }

  const [user, template] = await Promise.all([
    prisma.user.findUnique({
      where: { id: job.userId },
      select: { runwayApiKey: true, creditBalance: true },
    }),
    prisma.template.findUnique({
      where: { id: job.templateId },
      select: { dropboxDestinationPath: true, model: true, config: true },
    }),
  ]);

  const isRunway = template ? isRunwayImageToVideoModel(template.model) : false;
  if (!isRunway) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.FAILED,
        errorMessage: "Unsupported model (only Runway)",
        workflowPhase: null,
        completedAt: new Date(),
      },
    });
    return { outcome: "failed", error: "Unsupported model" };
  }

  const apiKey = await getRunwayApiKeyForUser(user?.runwayApiKey ?? null);
  if (!apiKey) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.FAILED,
        errorMessage: JOB_ERROR.NO_RUNWAY_API_KEY,
        workflowPhase: null,
        completedAt: new Date(),
      },
    });
    return { outcome: "failed", error: "No API key" };
  }

  const destPath = template?.dropboxDestinationPath;
  if (!destPath) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.FAILED,
        errorMessage: "Template has no Dropbox destination",
        workflowPhase: null,
        completedAt: new Date(),
      },
    });
    return { outcome: "failed", error: "No destination path" };
  }

  let videoUriHost: string | null = null;
  if (videoUri) {
    try {
      videoUriHost = new URL(videoUri).hostname;
    } catch {
      videoUriHost = null;
    }
    await persistRunwayVideoUri(jobId, videoUri);
  }

  const pendingKey = pendingJobVideoKey(job.userId, job.id);
  let videoBuffer = await getObjectBody(pendingKey);
  if (videoBuffer) {
    jobLog("complete", "using cached Runway video from S3", {
      jobId: job.id,
      pendingKey,
      bytes: videoBuffer.byteLength,
      source,
    });
    if (!videoUri) {
      videoUri = await resolveRunwayVideoUriForJob(jobId);
      if (videoUri) {
        await persistRunwayVideoUri(jobId, videoUri);
        try {
          videoUriHost = new URL(videoUri).hostname;
        } catch {
          videoUriHost = null;
        }
      }
    }
  } else {
    if (!videoUri) {
      videoUri = await resolveRunwayVideoUriForJob(jobId);
    }
    if (!videoUri) {
      return { outcome: "failed", error: "No Runway video URL available" };
    }
    await persistRunwayVideoUri(jobId, videoUri);
    try {
      videoUriHost = new URL(videoUri).hostname;
    } catch {
      videoUriHost = null;
    }

    jobLog("complete", "downloading video from Runway", {
      jobId: job.id,
      videoUriHost,
      source,
    });
    const downloadStartedAt = Date.now();
    videoBuffer = await downloadRunwayVideo(apiKey, videoUri, {
      logContext: { source, jobId: job.id, userId: job.userId, templateId: job.templateId, videoUriHost },
    });
    if (!videoBuffer) {
      jobLogError("complete", "Runway video download failed", {
        jobId: job.id,
        elapsedMs: Date.now() - downloadStartedAt,
      });
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: JOB_STATUS.FAILED,
          errorMessage: "Failed to download video from Runway",
          workflowPhase: null,
          completedAt: new Date(),
        },
      });
      return { outcome: "failed", error: "Download failed" };
    }
    const cachedKey = await uploadPendingJobVideo(job.userId, job.id, videoBuffer);
    if (cachedKey) {
      jobLog("complete", "cached Runway video to S3 for upload retries", {
        jobId: job.id,
        pendingKey: cachedKey,
        bytes: videoBuffer.byteLength,
      });
    }
  }

  if (videoBuffer && !videoUri) {
    await prisma.job.update({
      where: { id: job.id },
      data: { rateLimitClaimedAt: null },
    });
    jobLog("complete", "Runway slot released — video in S3, Dropbox upload pending", {
      jobId: job.id,
      source,
    });
  }

  const token = await getValidAccessToken(job.userId);
  if (!token) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.FAILED,
        errorMessage: JOB_ERROR.DROPBOX_NOT_CONNECTED,
        workflowPhase: null,
        completedAt: new Date(),
      },
    });
    return { outcome: "failed", error: "Dropbox not connected" };
  }

  const rawBaseName = job.dropboxSourceFilePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "video";
  const baseName = sanitizeOutputFileBaseName(rawBaseName);
  const operationId = operationName ?? job.providerOperationId;

  await prisma.job.update({
    where: { id: job.id },
    data: { workflowPhase: JOB_WORKFLOW_PHASE.UPLOADING },
  });

  const uploadLogContext = {
    source,
    jobId: job.id,
    userId: job.userId,
    templateId: job.templateId,
    templateModel: template?.model ?? null,
    providerOperationId: operationId,
    dropboxDestinationPath: destPath,
    dropboxSourceFilePath: job.dropboxSourceFilePath,
    hasPreGenImage: !!job.preGenImageKey,
    videoBufferBytes: videoBuffer.byteLength,
    videoUriLength: videoUri?.length ?? 0,
    videoUriHost: videoUriHost ?? null,
  };

  let uploadResult: Awaited<ReturnType<typeof uploadJobOutputToDropbox>>;
  let outputPath: string | undefined;
  try {
    uploadResult = await uploadJobOutputToDropbox({
      token,
      destPath,
      baseName,
      jobId: job.id,
      operationId,
      videoBuffer,
      onUnauthorized: () => getValidAccessTokenWithOptions(job.userId, { forceRefresh: true }),
      logContext: uploadLogContext,
    });
    outputPath = uploadResult.outputPath;
  } catch (err) {
    if (isDropboxRateLimitError(err)) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          ...(videoUri ? { runwayOutputVideoUri: videoUri } : {}),
          workflowPhase: JOB_WORKFLOW_PHASE.WAITING_DROPBOX_RATE_LIMIT,
        },
      });
      jobLog("complete", "Dropbox rate limited — deferring retry", {
        jobId: job.id,
        retryAfterSeconds: err.retryAfterSeconds,
        source,
      });
      return { outcome: "dropbox_rate_limited", retryAfterSeconds: err.retryAfterSeconds };
    }
    throw err;
  }

  if (!uploadResult.ok) {
    const errorMessage = formatDropboxUploadJobError(uploadResult.reason);
    const dropboxUploadErrorDetail = truncateDropboxUploadErrorDetail(uploadResult.reason);
    jobLogError("complete", "Dropbox upload failed", {
      jobId: job.id,
      source,
      reason: uploadResult.reason,
      status: uploadResult.status ?? null,
      videoBufferBytes: videoBuffer.byteLength,
      outputPath,
    });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.FAILED,
        errorMessage,
        dropboxUploadErrorDetail,
        runwayOutputVideoUri: videoUri ?? null,
        workflowPhase: null,
        completedAt: new Date(),
      },
    });
    return { outcome: "failed", error: errorMessage };
  }

  const config = template ? parseTemplateConfig(template.model, template.config as object) : null;
  const hasPreGen = !!job.preGenImageKey;
  const computed = config
    ? computeJobCost({
        model: template!.model,
        durationSeconds: config.durationSeconds,
        audio: config.audio,
        hasPreGen,
      })
    : { apiCost: 0, creditCost: 0 };
  const usePlatform = usesPlatformKey(user?.runwayApiKey ?? null);
  const deductCredits = usePlatform && computed.creditCost > 0;
  const apiCost = usePlatform ? computed.apiCost : 0;
  const creditCost = usePlatform ? computed.creditCost : 0;

  const finalPath = uploadResult.path_display ?? outputPath;
  if (!finalPath) {
    return { outcome: "failed", error: "Upload succeeded but no Dropbox path returned" };
  }

  jobLog("complete", "Dropbox upload succeeded", {
    jobId: job.id,
    outputDropboxPath: finalPath,
    source,
  });

  const completed = await prisma.$transaction(async (tx) => {
    const active = await tx.job.findFirst({
      where: {
        id: job.id,
        status: { in: [...ACTIVE_STATUSES] },
      },
      select: { id: true },
    });
    if (!active) {
      const existing = await tx.job.findUnique({
        where: { id: job.id },
        select: { status: true, outputDropboxPath: true },
      });
      return existing?.status === JOB_STATUS.COMPLETED ? "already" : "lost_race";
    }

    if (deductCredits) {
      await tx.user.update({
        where: { id: job.userId },
        data: { creditBalance: { decrement: new Prisma.Decimal(creditCost) } },
      });
      await tx.creditTransaction.create({
        data: {
          userId: job.userId,
          amount: new Prisma.Decimal(-creditCost),
          jobId: job.id,
          kind: CREDIT_KIND.SPEND,
          description: "Video generation",
        },
      });
    }

    await tx.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.COMPLETED,
        outputDropboxPath: finalPath,
        runwayOutputVideoUri: null,
        workflowPhase: null,
        runwayProgress: null,
        runwayPollStatus: null,
        completedAt: new Date(),
        apiCost: new Prisma.Decimal(apiCost),
        creditCost: new Prisma.Decimal(creditCost),
        errorMessage: null,
        dropboxUploadErrorDetail: null,
      },
    });
    return "completed";
  });

  if (completed === "already") {
    return { outcome: "already_completed", outputDropboxPath: job.outputDropboxPath };
  }
  if (completed === "lost_race") {
    return { outcome: "skipped", reason: "lost_race" };
  }

  if (deductCredits) {
    maybeAutoRecharge(job.userId).catch((err) =>
      jobLogError("complete", "auto-recharge error", {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  const outputKey = jobOutputVideoKey(job.userId, job.id);
  let outputCached = false;
  if (await s3ObjectExists(pendingKey)) {
    outputCached = await copyS3Object(pendingKey, outputKey);
  }
  if (!outputCached) {
    outputCached = !!(await uploadJobOutputVideo(job.userId, job.id, videoBuffer));
  }
  if (outputCached) {
    jobLog("complete", "output video cached to S3 for dashboard", {
      jobId: job.id,
      outputKey,
      source,
    });
  }

  await deletePendingJobVideo(job.userId, job.id);

  jobLog("complete", "job completed", { jobId: job.id, outputDropboxPath: finalPath, source });
  return { outcome: "completed", outputDropboxPath: finalPath };
}
