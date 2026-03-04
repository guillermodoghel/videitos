/**
 * Core logic: rate-limit check + send job to Veo + update DB.
 * Used by claim-and-process (Step Function) and optionally by other callers.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseTemplateConfig, getModelRateLimit } from "@/lib/video-models";
import { getObjectBody, isS3Key } from "@/lib/s3";
import { getValidAccessToken, downloadFile } from "@/lib/dropbox";
import { startVeoGeneration } from "@/lib/veo";

export type ProcessJobResult =
  | { ok: true; operationName: string }
  | { ok: false; error: string };

/**
 * If a slot is available (rate limit), run Veo for the job and update it to sent_to_veo.
 * Returns { ok: true, operationName } or { ok: false, error }.
 */
export async function processJobToVeo(jobId: string): Promise<ProcessJobResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      template: true,
      user: { select: { googleAiStudioApiKey: true } },
    },
  });

  if (!job) {
    console.log("[process-job] jobId=%s → Job not found", jobId);
    return { ok: false, error: "Job not found" };
  }
  // Already sent or completed: let Step Function proceed to polling (no loop)
  if (job.status === "sent_to_veo" && job.veoOperationName) {
    console.log("[process-job] jobId=%s already sent_to_veo → operationName=%s", jobId, job.veoOperationName);
    return { ok: true, operationName: job.veoOperationName };
  }
  if (job.status === "completed") {
    console.log("[process-job] jobId=%s already completed → operationName=%s", jobId, job.veoOperationName ?? "n/a");
    return { ok: true, operationName: job.veoOperationName ?? "" };
  }
  if (job.status !== "queued") {
    console.log("[process-job] jobId=%s → Job not queued (status=%s)", jobId, job.status);
    return { ok: false, error: `Job not queued (status: ${job.status})` };
  }

  const modelId = job.template.model;
  const limit = getModelRateLimit(modelId);
  const windowStart = new Date(Date.now() - limit.windowSeconds * 1000);

  // Claim a rate-limit slot in a serializable transaction so concurrent executions
  // don't both pass (race condition). On serialization conflict we retry a few times.
  const RATE_LIMIT_CLAIM_RETRIES = 3;
  let claimDone = false;
  for (let attempt = 0; attempt < RATE_LIMIT_CLAIM_RETRIES && !claimDone; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const inWindow = await tx.job.count({
            where: {
              userId: job.userId,
              template: { model: modelId },
              OR: [
                { sentToVeoAt: { gte: windowStart } },
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

  const apiKey = job.user?.googleAiStudioApiKey;
  if (!apiKey) {
    console.log("[process-job] jobId=%s → No API key", jobId);
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: "User has no Google API key", completedAt: new Date() },
    });
    return { ok: false, error: "No API key" };
  }

  const config = parseTemplateConfig(job.template.model, job.template.config);
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

  // Prefer file ID (Dropbox returns id as "id:xxxxx"; don't double-prefix)
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
    console.log("[process-job] jobId=%s → Veo error: %s", jobId, result.error);
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: result.error, completedAt: new Date() },
    });
    return { ok: false, error: result.error };
  }

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "sent_to_veo",
      veoOperationName: result.operationName,
      sentToVeoAt: new Date(),
    },
  });

  console.log("[process-job] jobId=%s → sent_to_veo operationName=%s", jobId, result.operationName);
  return { ok: true, operationName: result.operationName };
}
