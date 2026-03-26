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

  if (status === WEBHOOK_JOB_STATUS.ERROR) {
    const job = await findJob(jobId, operationName);
    if (job) {
      if (job.errorMessage === JOB_ERROR.CANCELED) {
        return NextResponse.json({ ok: true });
      }
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
    return NextResponse.json({ ok: true });
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

  const videoBuffer = await downloadRunwayVideo(apiKey, videoUri);
  if (!videoBuffer) {
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

  const token = await getValidAccessToken(job.userId);
  if (!token) {
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

  const uploadResult = await uploadFile(token, outputPath, videoBuffer, {
    mode: "add",
    onUnauthorized: () =>
      getValidAccessTokenWithOptions(job.userId, { forceRefresh: true }),
    maxRetries: 2,
  });
  if (!uploadResult) {
    console.error("[webhook/job] Upload failed", {
      jobId: job.id,
      outputPath,
      destinationPath: destPath,
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
      console.error("[webhook/job] auto-recharge error:", err)
    );
  }

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
