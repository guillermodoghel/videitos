import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { downloadRunwayVideo } from "@/lib/runway";
import { isRunwayImageToVideoModel } from "@/lib/video-models";
import { parseTemplateConfig } from "@/lib/video-models";
import { computeJobCost } from "@/lib/credits";
import { getRunwayApiKeyForUser, usesPlatformKey } from "@/lib/runway-api-key";
import { getValidAccessToken, getValidAccessTokenWithOptions, uploadFile } from "@/lib/dropbox";
import { maybeAutoRecharge } from "@/lib/stripe";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { WEBHOOK_JOB_STATUS } from "@/lib/constants/webhook-job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { CREDIT_KIND } from "@/lib/constants/credit-transaction-kind";
import { jobLog, jobLogError } from "@/lib/job-log";

/**
 * POST /api/webhook/job
 * Callback when Runway video generation is ready or failed.
 * Body: { status: "ready" | "error", videoUri?, error?, operationName?, jobId? }
 * - ready: find job, download video from Runway, upload to Dropbox, mark completed.
 * - error: mark job failed with errorMessage.
 */
export async function POST(request: NextRequest) {
  let body: {
    status?: string;
    videoUri?: string;
    error?: string;
    operationName?: string;
    jobId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = body.status;
  const videoUri = body.videoUri;
  const errorMsg = body.error;
  const operationName = body.operationName;
  const jobId = body.jobId;

  jobLog("webhook", "request received", {
    status,
    jobId: jobId ?? null,
    operationName: operationName ?? null,
    hasVideoUri: !!videoUri,
    error: errorMsg ?? null,
  });

  if (status === WEBHOOK_JOB_STATUS.ERROR) {
    const job = await findJob(jobId, operationName);
    if (job) {
      if (job.errorMessage === JOB_ERROR.CANCELED) {
        jobLog("webhook", "error ignored — job was canceled", { jobId: job.id });
        return NextResponse.json({ ok: true });
      }
      jobLogError("webhook", "marking job failed", {
        jobId: job.id,
        error: errorMsg ?? "Unknown error",
        previousStatus: job.status,
      });
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: JOB_STATUS.FAILED,
          errorMessage: errorMsg ?? "Unknown error",
          completedAt: new Date(),
        },
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (status !== WEBHOOK_JOB_STATUS.READY || !videoUri) {
    return NextResponse.json(
      { error: "status ready requires videoUri" },
      { status: 400 }
    );
  }

  const job = await findJob(jobId, operationName);
  if (!job) {
    jobLogError("webhook", "ready callback — job not found", { jobId, operationName });
    return NextResponse.json(
      { error: "Job not found" },
      { status: 404 }
    );
  }

  if (
    job.errorMessage === JOB_ERROR.CANCELED ||
    job.status !== JOB_STATUS.PROCESSING ||
    (operationName && job.providerOperationId !== operationName)
  ) {
    jobLog("webhook", "ready callback ignored (stale or canceled)", {
      jobId: job.id,
      jobStatus: job.status,
      jobOperationId: job.providerOperationId,
      callbackOperationId: operationName ?? null,
      canceled: job.errorMessage === JOB_ERROR.CANCELED,
    });
    return NextResponse.json({ ok: true });
  }

  jobLog("webhook", "processing ready callback", {
    jobId: job.id,
    userId: job.userId,
    templateId: job.templateId,
    operationName,
    sourcePath: job.dropboxSourceFilePath,
    hasPreGen: !!job.preGenImageKey,
  });

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
      data: { status: JOB_STATUS.FAILED, errorMessage: "Unsupported model (only Runway)", completedAt: new Date() },
    });
    return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
  }

  const apiKey = await getRunwayApiKeyForUser(user?.runwayApiKey ?? null);
  if (!apiKey) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JOB_STATUS.FAILED, errorMessage: JOB_ERROR.NO_RUNWAY_API_KEY, completedAt: new Date() },
    });
    return NextResponse.json({ error: "No API key" }, { status: 500 });
  }

  const destPath = template?.dropboxDestinationPath;
  if (!destPath) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.FAILED,
        errorMessage: "Template has no Dropbox destination",
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: "No destination path" }, { status: 500 });
  }

  let videoUriHost: string | null = null;
  try {
    videoUriHost = new URL(videoUri).hostname;
  } catch {
    videoUriHost = null;
  }

  jobLog("webhook", "downloading video from Runway", {
    jobId: job.id,
    videoUriHost,
    videoUriLength: videoUri.length,
  });
  const downloadStartedAt = Date.now();
  const videoBuffer = await downloadRunwayVideo(apiKey, videoUri, {
    logContext: {
      source: "webhook/job",
      jobId: job.id,
      userId: job.userId,
      templateId: job.templateId,
      videoUriHost,
    },
  });
  if (!videoBuffer) {
    jobLogError("webhook", "Runway video download failed", {
      jobId: job.id,
      elapsedMs: Date.now() - downloadStartedAt,
    });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.FAILED,
        errorMessage: "Failed to download video from Runway",
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }

  jobLog("webhook", "Runway video downloaded", {
    jobId: job.id,
    bytes: videoBuffer.byteLength,
    elapsedMs: Date.now() - downloadStartedAt,
  });

  const token = await getValidAccessToken(job.userId);
  if (!token) {
    jobLogError("webhook", "Dropbox not connected", { jobId: job.id, userId: job.userId });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.FAILED,
        errorMessage: JOB_ERROR.DROPBOX_NOT_CONNECTED,
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: "Dropbox not connected" }, { status: 500 });
  }

  const rawBaseName = job.dropboxSourceFilePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "video";
  const baseName = sanitizeOutputFileBaseName(rawBaseName);
  const outputFileName = `${baseName}-${Date.now()}.mp4`;
  const outputPath = destPath.endsWith("/") ? `${destPath}${outputFileName}` : `${destPath}/${outputFileName}`;

  jobLog("webhook", "uploading video to Dropbox", {
    jobId: job.id,
    outputPath,
    bytes: videoBuffer.byteLength,
    destinationFolder: destPath,
  });
  const uploadStartedAt = Date.now();
  const uploadResult = await uploadFile(token, outputPath, videoBuffer, {
    mode: "add",
    onUnauthorized: () =>
      getValidAccessTokenWithOptions(job.userId, { forceRefresh: true }),
    logContext: {
      source: "webhook/job",
      jobId: job.id,
      userId: job.userId,
      templateId: job.templateId,
      templateModel: template?.model ?? null,
      providerOperationId: operationName ?? null,
      dropboxDestinationPath: destPath,
      outputPath,
      dropboxSourceFilePath: job.dropboxSourceFilePath,
      hasPreGenImage: !!job.preGenImageKey,
      videoBufferBytes: videoBuffer.byteLength,
      videoUriLength: videoUri.length,
      videoUriHost,
    },
  });
  if (!uploadResult) {
    jobLogError("webhook", "Dropbox upload failed", {
      jobId: job.id,
      outputPath,
      elapsedMs: Date.now() - uploadStartedAt,
    });
    console.error("[webhook/job] Dropbox upload failed after uploadFile returned null", {
      jobId: job.id,
      userId: job.userId,
      templateId: job.templateId,
      templateModel: template?.model,
      providerOperationId: operationName ?? null,
      outputPath,
      destinationPath: destPath,
      dropboxSourceFilePath: job.dropboxSourceFilePath,
      videoBufferBytes: videoBuffer.byteLength,
      videoUriHost,
      errorMessageStored: JOB_ERROR.DROPBOX_UPLOAD_FAILED,
      hint: "See preceding [Dropbox upload] logs for status, requestId, and Dropbox error body",
    });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.FAILED,
        errorMessage: JOB_ERROR.DROPBOX_UPLOAD_FAILED,
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
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

  jobLog("webhook", "Dropbox upload succeeded", {
    jobId: job.id,
    outputPath: uploadResult.path_display ?? outputPath,
    elapsedMs: Date.now() - uploadStartedAt,
    deductCredits,
    creditCost: deductCredits ? creditCost : 0,
  });

  await prisma.$transaction(async (tx) => {
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
        outputDropboxPath: uploadResult.path_display ?? outputPath,
        completedAt: new Date(),
        apiCost: new Prisma.Decimal(apiCost),
        creditCost: new Prisma.Decimal(creditCost),
      },
    });
  });

  // Fire-and-forget auto-recharge check after credits deducted
  if (deductCredits) {
    maybeAutoRecharge(job.userId).catch((err) =>
      jobLogError("webhook", "auto-recharge error", {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  jobLog("webhook", "job completed", {
    jobId: job.id,
    outputDropboxPath: uploadResult.path_display ?? outputPath,
    creditCost: deductCredits ? creditCost : 0,
  });

  return NextResponse.json({ ok: true, outputDropboxPath: outputPath });
}

function sanitizeOutputFileBaseName(input: string): string {
  const normalized = input.normalize("NFKC");
  const cleaned = normalized
    .replace(/[\u0000-\u001F\u007F]/g, "") // control chars
    .replace(/[\\/:"*<>|]/g, "_") // problematic separators/specials
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "video";
}

async function findJob(
  jobId: string | undefined,
  operationName: string | undefined
) {
  if (jobId) {
    const byId = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        userId: true,
        templateId: true,
        status: true,
        errorMessage: true,
        providerOperationId: true,
        dropboxSourceFilePath: true,
        preGenImageKey: true,
      },
    });
    if (byId) return byId;
  }
  if (operationName) {
    const byOp = await prisma.job.findFirst({
      where: { providerOperationId: operationName },
      select: {
        id: true,
        userId: true,
        templateId: true,
        status: true,
        errorMessage: true,
        providerOperationId: true,
        dropboxSourceFilePath: true,
        preGenImageKey: true,
      },
    });
    return byOp ?? null;
  }
  return null;
}
