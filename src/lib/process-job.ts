/**
 * Core logic: rate-limit check + send job to provider (Runway) + update DB.
 * Used by the job workflow (Vercel Workflow) and optionally by other callers.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseTemplateConfig, getModelRateLimit, isRunwayImageToVideoModel, RUNWAY_IMAGE_TO_VIDEO_IDS } from "@/lib/video-models";
import { getObjectBody, isS3Key, uploadPreGenOutputImage } from "@/lib/s3";
import { getValidAccessToken, downloadFile } from "@/lib/dropbox";
import {
  startRunwayImageToVideo,
  aspectRatioToRunwayRatio,
  runRunwayTextToImageAndWait,
  type RunwayImageToVideoModel,
  type RunwayTextToImageRatio,
} from "@/lib/runway";

export type ProcessJobResult =
  | { ok: true; operationName: string }
  | { ok: false; error: string };

export type ProcessJobOptions = {
  /** When true (e.g. from Cloud Tasks callback), skip DB rate-limit claim; queue enforces rate. */
  skipRateLimit?: boolean;
};

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
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      template: true,
      user: { select: { runwayApiKey: true } },
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
      const dropboxImageBuf = await downloadFile(token, sourcePathOrId);
      if (dropboxImageBuf) {
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
          data: { status: "failed", errorMessage: "Pre-generation: no valid reference images", completedAt: new Date() },
        });
        return { ok: false, error: "Pre-gen refs missing" };
      }
      console.log("[process-job] jobId=%s → Pre-gen: text-to-image (%s refs, character from Dropbox)", jobId, refUris.length);
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
        const isRateLimit = preGenResult.error === "rate_limit";
        console.log("[process-job] jobId=%s → Pre-gen error: %s%s", jobId, preGenResult.error, isRateLimit ? " (retry)" : "");
        if (!isRateLimit) {
          await prisma.job.update({
            where: { id: job.id },
            data: { status: "failed", errorMessage: `Pre-generation: ${preGenResult.error}`, completedAt: new Date() },
          });
        }
        return { ok: false, error: preGenResult.error };
      }
      promptImage = preGenResult.imageUri;
      const imageRes = await fetch(preGenResult.imageUri);
      if (imageRes.ok) {
        const imageBuf = Buffer.from(await imageRes.arrayBuffer());
        const contentType = imageRes.headers.get("content-type") ?? "image/png";
        const mime = contentType.includes("png") ? "image/png" : "image/jpeg";
        const key = await uploadPreGenOutputImage(job.userId, job.id, imageBuf, mime);
        if (key) {
          await prisma.job.update({
            where: { id: job.id },
            data: { preGenImageKey: key },
          });
        }
      }
      console.log("[process-job] jobId=%s → Pre-gen done, using image as first frame", jobId);
    } else {
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
      promptImage = `data:${newMime};base64,${newImageBuf.toString("base64")}`;
    }
    const ratio = config.runwayRatio ?? aspectRatioToRunwayRatio(config.aspectRatio);
    const result = await startRunwayImageToVideo(apiKey, {
      model: modelId as RunwayImageToVideoModel,
      promptText: config.prompt,
      promptImage,
      ratio,
      duration: config.durationSeconds,
      ...((modelId === "veo3.1" || modelId === "veo3.1_fast") && { audio: config.audio !== false }),
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

  // Only Runway models are supported (native Veo removed)
  console.log("[process-job] jobId=%s → Unsupported model: %s", jobId, modelId);
  await prisma.job.update({
    where: { id: job.id },
    data: { status: "failed", errorMessage: "Unsupported model (only Runway is supported)", completedAt: new Date() },
  });
  return { ok: false, error: "Unsupported model" };
}
