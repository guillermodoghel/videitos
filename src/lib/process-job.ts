/**
 * Core logic: rate-limit check + send job to provider (Runway) + update DB.
 * Used by the job workflow (Vercel Workflow) and optionally by other callers.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseTemplateConfig, getModelRateLimit, isRunwayImageToVideoModel, RUNWAY_IMAGE_TO_VIDEO_IDS } from "@/lib/video-models";
import { computeJobCost } from "@/lib/credits";
import { getObjectBody, isS3Key, uploadPreGenOutputImage } from "@/lib/s3";
import { getValidAccessToken, getValidAccessTokenWithOptions, downloadFile } from "@/lib/dropbox";
import { downloadRunwayVideo } from "@/lib/runway";
import {
  startRunwayImageToVideo,
  aspectRatioToRunwayRatio,
  runRunwayTextToImageAndWait,
  type RunwayImageToVideoModel,
  type RunwayTextToImageRatio,
} from "@/lib/runway";
import { getRunwayApiKeyForUser, usesPlatformKey } from "@/lib/runway-api-key";
import { maybeAutoRecharge } from "@/lib/stripe";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { jobLog, jobLogError } from "@/lib/job-log";
import { isRunwayInsufficientCreditsError } from "@/lib/runway-errors";
import { JOB_WORKFLOW_PHASE } from "@/lib/constants/job-workflow-phase";
import { setJobWorkflowPhase } from "@/lib/set-job-workflow-phase";

export type ProcessJobResult =
  | { ok: true; operationName: string }
  | { ok: false; error: string };

export type ProcessJobOptions = {
  /** When true (e.g. from Cloud Tasks callback), skip DB rate-limit claim; queue enforces rate. */
  skipRateLimit?: boolean;
};

/** Queued jobs with a recent claim are mid-start (download / pre-gen) and use a Runway slot. */
const RUNWAY_CLAIM_MAX_AGE_MS = 15 * 60 * 1000;

function activeRunwayJobsWhere(opts: { userId?: string; platformKeyOnly?: boolean }) {
  const claimSince = new Date(Date.now() - RUNWAY_CLAIM_MAX_AGE_MS);
  return {
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.platformKeyOnly ? { user: { runwayApiKey: null } } : {}),
    template: { model: { in: [...RUNWAY_IMAGE_TO_VIDEO_IDS] } },
    OR: [
      { status: JOB_STATUS.PROCESSING },
      {
        status: JOB_STATUS.QUEUED,
        rateLimitClaimedAt: { gte: claimSince },
      },
    ],
  };
}

/**
 * Run video generation (Runway) for the job and update it to processing.
 * When skipRateLimit is false, claims a rate-limit slot in DB first.
 * Returns { ok: true, operationName } or { ok: false, error }.
 * error "rate_limit" means caller should retry (e.g. return 429).
 */
export async function processJob(
  jobId: string,
  options: ProcessJobOptions = {}
): Promise<ProcessJobResult> {
  const { skipRateLimit = false } = options;
  const startedAt = Date.now();
  jobLog("process", "started", { jobId, skipRateLimit });

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      template: true,
      user: { select: { runwayApiKey: true, creditBalance: true } },
    },
  });

  if (!job) {
    jobLogError("process", "job not found", { jobId });
    return { ok: false, error: "Job not found" };
  }

  jobLog("process", "job loaded", {
    jobId,
    status: job.status,
    userId: job.userId,
    templateId: job.templateId,
    templateName: job.template.name,
    model: job.template.model,
    sourcePath: job.dropboxSourceFilePath,
    hasSourceFileId: !!job.dropboxSourceFileId,
    providerOperationId: job.providerOperationId,
  });

  // Already sent or completed: let workflow proceed to polling (no loop)
  if (job.status === JOB_STATUS.PROCESSING && job.providerOperationId) {
    jobLog("process", "already processing — resuming poll", {
      jobId,
      operationName: job.providerOperationId,
    });
    return { ok: true, operationName: job.providerOperationId };
  }
  if (job.status === JOB_STATUS.COMPLETED) {
    jobLog("process", "already completed — resuming poll", {
      jobId,
      operationName: job.providerOperationId ?? null,
    });
    return { ok: true, operationName: job.providerOperationId ?? "" };
  }
  if (job.status !== JOB_STATUS.QUEUED) {
    jobLogError("process", "invalid status for process", { jobId, status: job.status });
    return { ok: false, error: `Job not queued (status: ${job.status})` };
  }

  const modelId = job.template.model;

  const userHasKey = !!job.user?.runwayApiKey?.trim();
  const usePlatformKey = usesPlatformKey(job.user?.runwayApiKey ?? null);

  await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.CLAIMING_SLOT);

  if (!skipRateLimit) {
    const limit = getModelRateLimit(modelId);
    const maxConcurrent = limit.maxConcurrent ?? 1;
    const isRunwayModel = isRunwayImageToVideoModel(modelId);
    const windowStart = new Date(Date.now() - limit.windowSeconds * 1000);
    const RATE_LIMIT_CLAIM_RETRIES = 3;
    let claimDone = false;
    let lastRateLimitReason: string | null = null;
    let lastActiveCount: number | null = null;
    for (let attempt = 0; attempt < RATE_LIMIT_CLAIM_RETRIES && !claimDone; attempt++) {
      try {
        await prisma.$transaction(
          async (tx) => {
            if (isRunwayModel) {
              const activeWhere = userHasKey
                ? activeRunwayJobsWhere({ userId: job.userId })
                : activeRunwayJobsWhere({ platformKeyOnly: true });
              const activeCount = await tx.job.count({
                where: { id: { not: jobId }, ...activeWhere },
              });
              if (activeCount >= maxConcurrent) {
                lastRateLimitReason = "concurrent";
                lastActiveCount = activeCount;
                throw new Error("rate_limit");
              }
            } else {
              const windowWhere = {
                template: { model: modelId },
                sentAt: { gte: windowStart },
              };
              if (userHasKey) {
                const inWindow = await tx.job.count({
                  where: { userId: job.userId, ...windowWhere },
                });
                if (inWindow >= limit.requestsPerWindow) {
                  lastRateLimitReason = "window";
                  throw new Error("rate_limit");
                }
              } else {
                const inWindow = await tx.job.count({
                  where: { user: { runwayApiKey: null }, ...windowWhere },
                });
                if (inWindow >= limit.requestsPerWindow) {
                  lastRateLimitReason = "window";
                  throw new Error("rate_limit");
                }
              }
            }
            const updated = await tx.job.updateMany({
              where: { id: jobId, status: JOB_STATUS.QUEUED },
              data: { rateLimitClaimedAt: new Date() },
            });
            if (updated.count === 0) {
              lastRateLimitReason = "claim_race";
              throw new Error("rate_limit");
            }
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 10000,
          }
        );
        claimDone = true;
        jobLog("process", "rate limit slot claimed", {
          jobId,
          model: modelId,
          userHasKey,
          usePlatformKey,
          maxConcurrent,
          requestsPerWindow: limit.requestsPerWindow,
          windowSeconds: limit.windowSeconds,
        });
      } catch (e) {
        const isRateLimit = e instanceof Error && e.message === "rate_limit";
        const isSerialization =
          e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2034";
        if (isRateLimit) {
          jobLog("process", "rate limited — will retry", {
            jobId,
            attempt: attempt + 1,
            reason: lastRateLimitReason ?? "unknown",
            activeCount: lastActiveCount,
            maxConcurrent,
          });
          return { ok: false, error: "rate_limit" };
        }
        if (isSerialization && attempt < RATE_LIMIT_CLAIM_RETRIES - 1) {
          jobLog("process", "serialization conflict — retrying claim", {
            jobId,
            attempt: attempt + 1,
          });
          continue;
        }
        if (isSerialization) {
          jobLog("process", "rate limited — serialization retries exhausted", { jobId });
          return { ok: false, error: "rate_limit" };
        }
        throw e;
      }
    }
  }

  const config = parseTemplateConfig(job.template.model, job.template.config);
  const isRunway = isRunwayImageToVideoModel(modelId);

  if (isRunway) {
    const apiKey = await getRunwayApiKeyForUser(job.user?.runwayApiKey ?? null);
    if (!apiKey) {
      console.log("[process-job] jobId=%s → No Runway API key (user has none and no platform key)", jobId);
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: JOB_STATUS.FAILED,
          errorMessage: JOB_ERROR.NO_RUNWAY_API_KEY,
          workflowPhase: null,
          completedAt: new Date(),
        },
      });
      return { ok: false, error: "No API key" };
    }
    if (usePlatformKey) {
      const hasPreGen = !!(config.preGen?.prompt && config.preGen.referenceImageUrls && config.preGen.referenceImageUrls.length >= 1);
      const { creditCost } = computeJobCost({
        model: modelId,
        durationSeconds: config.durationSeconds,
        audio: config.audio,
        hasPreGen,
      });
      const balance = Number(job.user?.creditBalance ?? 0);
      if (balance < creditCost) {
        jobLog("process", "insufficient Videitos credits — failing job", {
          jobId,
          balance,
          creditCost,
        });
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: JOB_STATUS.FAILED,
            errorMessage: JOB_ERROR.INSUFFICIENT_CREDITS,
            workflowPhase: null,
            completedAt: new Date(),
            rateLimitClaimedAt: null,
          },
        });
        maybeAutoRecharge(job.userId, job.id).catch((err) =>
          jobLogError("process", "auto-recharge error", {
            jobId,
            error: err instanceof Error ? err.message : String(err),
          })
        );
        return { ok: false, error: JOB_ERROR.INSUFFICIENT_CREDITS_CODE };
      }
    }
    const token = await getValidAccessToken(job.userId);
    if (!token) {
      console.log("[process-job] jobId=%s → Dropbox not connected", jobId);
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: JOB_STATUS.FAILED,
          errorMessage: JOB_ERROR.DROPBOX_NOT_CONNECTED,
          workflowPhase: null,
          completedAt: new Date(),
        },
      });
      return { ok: false, error: "Dropbox not connected" };
    }

    const dropboxDownloadOptions = {
      onUnauthorized: () =>
        getValidAccessTokenWithOptions(job.userId, { forceRefresh: true }),
      logContext: { source: "process-job", jobId },
    };

    await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.PREPARING);

    let promptImage: string;

    const preGen = config.preGen;
    if (preGen?.prompt?.trim() && preGen.referenceImageUrls?.length >= 1) {
      const refUris: { uri: string; tag?: string }[] = [];
      for (const key of preGen.referenceImageUrls.slice(0, 2)) {
        if (!isS3Key(key)) continue;
        const buf = await getObjectBody(key);
        if (!buf) continue;
        const mime = key.toLowerCase().endsWith(".png") ? "image/png" : key.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
        refUris.push({ uri: `data:${mime};base64,${buf.toString("base64")}` });
      }
      const sourcePathOrId = job.dropboxSourceFileId
        ? job.dropboxSourceFileId.startsWith("id:")
          ? job.dropboxSourceFileId
          : `id:${job.dropboxSourceFileId}`
        : job.dropboxSourceFilePath;
      jobLog("process", "downloading source image (pre-gen path)", { jobId, sourcePathOrId });
      const dropboxImageBuf = await downloadFile(token, sourcePathOrId, dropboxDownloadOptions);
      if (dropboxImageBuf) {
        jobLog("process", "source image downloaded (pre-gen path)", {
          jobId,
          bytes: dropboxImageBuf.byteLength,
        });
        const ext = job.dropboxSourceFilePath.split(".").pop()?.toLowerCase() ?? "jpg";
        const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        refUris.push({
          uri: `data:${mime};base64,${dropboxImageBuf.toString("base64")}`,
          tag: "character",
        });
      }
      if (refUris.length < 1) {
        console.log("[process-job] jobId=%s → Pre-gen: no valid reference images", jobId);
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: JOB_STATUS.FAILED,
            errorMessage: "Pre-generation: no valid reference images",
            workflowPhase: null,
            completedAt: new Date(),
          },
        });
        return { ok: false, error: "Pre-gen refs missing" };
      }
      // Show as processing in UI while creating first image (pre-gen)
      await prisma.job.update({
        where: { id: job.id },
        data: { status: JOB_STATUS.PROCESSING },
      });
      jobLog("process", "pre-gen text-to-image starting", {
        jobId,
        refCount: refUris.length,
        hasCharacterFromDropbox: refUris.some((r) => r.tag === "character"),
      });
      const imageToVideoRatio = config.runwayRatio ?? aspectRatioToRunwayRatio(config.aspectRatio);
      const preGenRatio: RunwayTextToImageRatio =
        imageToVideoRatio === "1280:720" || imageToVideoRatio === "720:1280"
          ? imageToVideoRatio
          : aspectRatioToRunwayRatio(config.aspectRatio);
      const preGenResult = await runRunwayTextToImageAndWait(apiKey, {
        promptText: preGen.prompt.trim(),
        ratio: preGenRatio,
        referenceImages: refUris,
      });
      if ("error" in preGenResult) {
        return handleRunwayStepError(job, jobId, preGenResult.error, "Pre-generation");
      }
      promptImage = preGenResult.imageUri;
      const imageBuf = await downloadRunwayVideo(apiKey, preGenResult.imageUri, {
        logContext: { source: "process-job", jobId, step: "preGenImage" },
      });
      if (imageBuf) {
        const key = await uploadPreGenOutputImage(job.userId, job.id, imageBuf, "image/png");
        if (key) {
          await prisma.job.update({
            where: { id: job.id },
            data: { preGenImageKey: key },
          });
        }
      }
      jobLog("process", "pre-gen complete", { jobId, hasPreGenImageKey: !!imageBuf });
    } else {
      const sourcePathOrId = job.dropboxSourceFileId
        ? job.dropboxSourceFileId.startsWith("id:")
          ? job.dropboxSourceFileId
          : `id:${job.dropboxSourceFileId}`
        : job.dropboxSourceFilePath;
      jobLog("process", "downloading source image", { jobId, sourcePathOrId });
      const newImageBuf = await downloadFile(token, sourcePathOrId, dropboxDownloadOptions);
      if (!newImageBuf) {
        jobLogError("process", "source image download failed", { jobId, sourcePathOrId });
        await prisma.job.update({
          where: { id: job.id },
            data: {
              status: JOB_STATUS.FAILED,
              errorMessage: "Failed to download source image from Dropbox",
              workflowPhase: null,
              completedAt: new Date(),
            },
        });
        return { ok: false, error: "Failed to download source image" };
      }
      const ext = job.dropboxSourceFilePath.split(".").pop()?.toLowerCase() ?? "jpg";
      const newMime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      jobLog("process", "source image downloaded", { jobId, bytes: newImageBuf.byteLength, mime: newMime });
      promptImage = `data:${newMime};base64,${newImageBuf.toString("base64")}`;
    }
    const ratio = config.runwayRatio ?? aspectRatioToRunwayRatio(config.aspectRatio);
    await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.SUBMITTING);
    jobLog("process", "submitting to Runway image-to-video", {
      jobId,
      model: modelId,
      ratio,
      durationSeconds: config.durationSeconds,
      hasPreGenPath: !!(preGen?.prompt?.trim() && preGen.referenceImageUrls?.length),
    });
    const result = await startRunwayImageToVideo(apiKey, {
      model: modelId as RunwayImageToVideoModel,
      promptText: config.prompt,
      promptImage,
      ratio,
      duration: config.durationSeconds,
      ...((modelId === "veo3.1" || modelId === "veo3.1_fast") && { audio: config.audio !== false }),
    });
    if ("error" in result) {
      return handleRunwayStepError(job, jobId, result.error);
    }
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.PROCESSING,
        providerOperationId: result.taskId,
        sentAt: new Date(),
        errorMessage: null,
        workflowPhase: JOB_WORKFLOW_PHASE.GENERATING,
      },
    });
    jobLog("process", "submitted to Runway — now processing", {
      jobId,
      taskId: result.taskId,
      elapsedMs: Date.now() - startedAt,
    });
    return { ok: true, operationName: result.taskId };
  }

  // Only Runway models are supported (native Veo removed)
  console.log("[process-job] jobId=%s → Unsupported model: %s", jobId, modelId);
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: JOB_STATUS.FAILED,
      errorMessage: JOB_ERROR.UNSUPPORTED_MODEL,
      workflowPhase: null,
      completedAt: new Date(),
    },
  });
  return { ok: false, error: "Unsupported model" };
}

async function handleRunwayStepError(
  job: { id: string },
  jobId: string,
  error: string,
  prefix?: string
): Promise<ProcessJobResult> {
  const displayError = prefix ? `${prefix}: ${error}` : error;

  if (error === "rate_limit") {
    jobLog("process", "Runway rate limit — will retry", { jobId, error });
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JOB_STATUS.QUEUED, rateLimitClaimedAt: null },
    });
    return { ok: false, error: "rate_limit" };
  }

  if (isRunwayInsufficientCreditsError(error)) {
    jobLog("process", "Runway insufficient credits — will retry", { jobId, error });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.QUEUED,
        errorMessage: JOB_ERROR.RUNWAY_INSUFFICIENT_CREDITS,
        workflowPhase: JOB_WORKFLOW_PHASE.WAITING_RUNWAY_CREDITS,
        completedAt: null,
        providerOperationId: null,
        sentAt: null,
        rateLimitClaimedAt: null,
      },
    });
    return { ok: false, error: JOB_ERROR.RUNWAY_INSUFFICIENT_CREDITS_CODE };
  }

  jobLogError("process", "Runway error (fatal)", { jobId, error: displayError });
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: JOB_STATUS.FAILED,
      errorMessage: displayError,
      workflowPhase: null,
      completedAt: new Date(),
    },
  });
  return { ok: false, error: displayError };
}

/** Reset job after Runway credits error during poll so process phase can run again. */
export async function resetJobForRunwayCreditsRetry(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JOB_STATUS.QUEUED,
      errorMessage: JOB_ERROR.RUNWAY_INSUFFICIENT_CREDITS,
      workflowPhase: JOB_WORKFLOW_PHASE.WAITING_RUNWAY_CREDITS,
      completedAt: null,
      providerOperationId: null,
      sentAt: null,
      rateLimitClaimedAt: null,
    },
  });
  jobLog("process", "job reset for Runway credits retry", { jobId });
}

/** Called by workflow after Runway out-of-credits retries are exhausted. */
export async function markJobFailedRunwayInsufficientCredits(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JOB_STATUS.FAILED,
      errorMessage: JOB_ERROR.RUNWAY_INSUFFICIENT_CREDITS,
      workflowPhase: null,
      completedAt: new Date(),
      rateLimitClaimedAt: null,
    },
  });
  jobLogError("process", "Runway insufficient credits — retries exhausted, job failed", { jobId });
}
