/**
 * Core logic: rate-limit check + send job to provider (Veo/Runway) + update DB.
 * Used by the job workflow (Vercel Workflow) and optionally by other callers.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseTemplateConfig, getModelRateLimit, isRunwayImageToVideoModel, RUNWAY_IMAGE_TO_VIDEO_IDS } from "@/lib/video-models";
import { getObjectBody, isS3Key } from "@/lib/s3";
import { getValidAccessToken, downloadFile } from "@/lib/dropbox";
import { startVeoGeneration } from "@/lib/veo";
import { startRunwayImageToVideo, aspectRatioToRunwayRatio, type RunwayImageToVideoModel } from "@/lib/runway";

export type ProcessJobResult =
  | { ok: true; operationName: string }
  | { ok: false; error: string };

export type ProcessJobOptions = {
  /** When true (e.g. from Cloud Tasks callback), skip DB rate-limit claim; queue enforces rate. */
  skipRateLimit?: boolean;
};

/**
 * Run video generation (Veo or Runway) for the job and update it to processing.
 * When skipRateLimit is false, claims a rate-limit slot in DB first.
 * Returns { ok: true, operationName } or { ok: false, error }.
 * error "rate_limit" means caller should retry (e.g. return 429).
 */
export async function processJob(
  jobId: string,
  options: ProcessJobOptions = {}
): Promise<ProcessJobResult> {
  const { skipRateLimit = false } = options;
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      template: true,
      user: { select: { googleAiStudioApiKey: true, runwayApiKey: true } },
    },
  });

  if (!job) {
    console.log("[process-job] jobId=%s → Job not found", jobId);
    return { ok: false, error: "Job not found" };
  }
  // Already sent or completed: let workflow proceed to polling (no loop)
  if (job.status === "processing" && job.providerOperationId) {
    console.log("[process-job] jobId=%s already processing → operationName=%s", jobId, job.providerOperationId);
    return { ok: true, operationName: job.providerOperationId };
  }
  if (job.status === "completed") {
    console.log("[process-job] jobId=%s already completed → operationName=%s", jobId, job.providerOperationId ?? "n/a");
    return { ok: true, operationName: job.providerOperationId ?? "" };
  }
  if (job.status !== "queued") {
    console.log("[process-job] jobId=%s → Job not queued (status=%s)", jobId, job.status);
    return { ok: false, error: `Job not queued (status: ${job.status})` };
  }

  const modelId = job.template.model;

  if (!skipRateLimit) {
    const limit = getModelRateLimit(modelId);
    const isRunwayModel = isRunwayImageToVideoModel(modelId);
    const windowStart = new Date(Date.now() - limit.windowSeconds * 1000);
    const RATE_LIMIT_CLAIM_RETRIES = 3;
    let claimDone = false;
    for (let attempt = 0; attempt < RATE_LIMIT_CLAIM_RETRIES && !claimDone; attempt++) {
      try {
        await prisma.$transaction(
          async (tx) => {
            // Runway: only one concurrent task per user (any Runway model)
            if (isRunwayModel) {
              const runwayInProgress = await tx.job.count({
                where: {
                  userId: job.userId,
                  status: "processing",
                  template: { model: { in: [...RUNWAY_IMAGE_TO_VIDEO_IDS] } },
                },
              });
              if (runwayInProgress >= 1) {
                throw new Error("rate_limit");
              }
            }
            const inWindow = await tx.job.count({
              where: {
                userId: job.userId,
                template: { model: modelId },
                OR: [
                  { sentAt: { gte: windowStart } },
                  { rateLimitClaimedAt: { gte: windowStart } },
                ],
              },
            });
            if (inWindow >= limit.requestsPerWindow) {
              throw new Error("rate_limit");
            }
            const updated = await tx.job.updateMany({
              where: { id: jobId, status: "queued" },
              data: { rateLimitClaimedAt: new Date() },
            });
            if (updated.count === 0) {
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
      } catch (e) {
        const isRateLimit = e instanceof Error && e.message === "rate_limit";
        const isSerialization =
          e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2034";
        if (isRateLimit) {
          console.log("[process-job] jobId=%s → rate_limit (slot claimed by another or window full)", jobId);
          return { ok: false, error: "rate_limit" };
        }
        if (isSerialization && attempt < RATE_LIMIT_CLAIM_RETRIES - 1) {
          continue;
        }
        if (isSerialization) {
          console.log("[process-job] jobId=%s → rate_limit (serialization retries exhausted)", jobId);
          return { ok: false, error: "rate_limit" };
        }
        throw e;
      }
    }
  }

  const config = parseTemplateConfig(job.template.model, job.template.config);
  const isRunway = isRunwayImageToVideoModel(modelId);

  if (isRunway) {
    const apiKey = job.user?.runwayApiKey;
    if (!apiKey) {
      console.log("[process-job] jobId=%s → No Runway API key", jobId);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: "User has no Runway API key", completedAt: new Date() },
      });
      return { ok: false, error: "No API key" };
    }
    const token = await getValidAccessToken(job.userId);
    if (!token) {
      console.log("[process-job] jobId=%s → Dropbox not connected", jobId);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: "Dropbox not connected", completedAt: new Date() },
      });
      return { ok: false, error: "Dropbox not connected" };
    }
    const sourcePathOrId = job.dropboxSourceFileId
      ? job.dropboxSourceFileId.startsWith("id:")
        ? job.dropboxSourceFileId
        : `id:${job.dropboxSourceFileId}`
      : job.dropboxSourceFilePath;
    const newImageBuf = await downloadFile(token, sourcePathOrId);
    if (!newImageBuf) {
      console.log("[process-job] jobId=%s → Failed to download source image from Dropbox", jobId);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: "Failed to download source image from Dropbox", completedAt: new Date() },
      });
      return { ok: false, error: "Failed to download source image" };
    }
    const ext = job.dropboxSourceFilePath.split(".").pop()?.toLowerCase() ?? "jpg";
    const newMime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const promptImage = `data:${newMime};base64,${newImageBuf.toString("base64")}`;
    const result = await startRunwayImageToVideo(apiKey, {
      model: modelId as RunwayImageToVideoModel,
      promptText: config.prompt,
      promptImage,
      ratio: aspectRatioToRunwayRatio(config.aspectRatio),
      duration: config.durationSeconds,
      ...(modelId === "veo3.1_fast" && { audio: config.audio === true }),
    });
    if ("error" in result) {
      const isRateLimit = result.error === "rate_limit";
      console.log("[process-job] jobId=%s → Runway error: %s%s", jobId, result.error, isRateLimit ? " (retry)" : "");
      if (!isRateLimit) {
        await prisma.job.update({
          where: { id: job.id },
          data: { status: "failed", errorMessage: result.error, completedAt: new Date() },
        });
      }
      return { ok: false, error: result.error };
    }
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "processing",
        providerOperationId: result.taskId,
        sentAt: new Date(),
      },
    });
    console.log("[process-job] jobId=%s → processing (Runway) taskId=%s", jobId, result.taskId);
    return { ok: true, operationName: result.taskId };
  }

  const apiKey = job.user?.googleAiStudioApiKey;
  if (!apiKey) {
    console.log("[process-job] jobId=%s → No API key", jobId);
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: "User has no Google API key", completedAt: new Date() },
    });
    return { ok: false, error: "No API key" };
  }

  const refUrls = config.referenceImageUrls ?? [];
  const images: { imageBytes: string; mimeType: string }[] = [];

  for (const ref of refUrls.slice(0, 2)) {
    if (!isS3Key(ref)) continue;
    const buf = await getObjectBody(ref);
    if (!buf) continue;
    const mime = ref.toLowerCase().endsWith(".png") ? "image/png" : ref.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
    images.push({ imageBytes: buf.toString("base64"), mimeType: mime });
  }

  const token = await getValidAccessToken(job.userId);
  if (!token) {
    console.log("[process-job] jobId=%s → Dropbox not connected", jobId);
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: "Dropbox not connected", completedAt: new Date() },
    });
    return { ok: false, error: "Dropbox not connected" };
  }

  const sourcePathOrId = job.dropboxSourceFileId
    ? job.dropboxSourceFileId.startsWith("id:")
      ? job.dropboxSourceFileId
      : `id:${job.dropboxSourceFileId}`
    : job.dropboxSourceFilePath;
  console.log("[process-job] jobId=%s download: %s (fileId=%s, path=%s)", jobId, job.dropboxSourceFileId ? "by id" : "by path", job.dropboxSourceFileId ?? "none", job.dropboxSourceFilePath);
  const newImageBuf = await downloadFile(token, sourcePathOrId);
  if (!newImageBuf) {
    console.log("[process-job] jobId=%s → Failed to download source image (see [Dropbox download] log above)", jobId);
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: "Failed to download source image from Dropbox", completedAt: new Date() },
    });
    return { ok: false, error: "Failed to download source image" };
  }

  const ext = job.dropboxSourceFilePath.split(".").pop()?.toLowerCase() ?? "jpg";
  const newMime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  images.push({ imageBytes: newImageBuf.toString("base64"), mimeType: newMime });
  if (images.length < 1) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: "No input images", completedAt: new Date() },
    });
    return { ok: false, error: "No input images" };
  }

  const result = await startVeoGeneration(apiKey, { prompt: config.prompt, config, images });

  if ("error" in result) {
    const isRateLimit = result.error === "rate_limit";
    console.log("[process-job] jobId=%s → provider error: %s%s", jobId, result.error, isRateLimit ? " (retry)" : "");
    if (!isRateLimit) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: result.error, completedAt: new Date() },
      });
    }
    return { ok: false, error: result.error };
  }

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "processing",
      providerOperationId: result.operationName,
      sentAt: new Date(),
    },
  });

  console.log("[process-job] jobId=%s → processing operationName=%s", jobId, result.operationName);
  return { ok: true, operationName: result.operationName };
}
