import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { downloadRunwayVideo } from "@/lib/runway";
import { isRunwayImageToVideoModel } from "@/lib/video-models";
import { parseTemplateConfig } from "@/lib/video-models";
import { computeJobCost } from "@/lib/credits";
import { getRunwayApiKeyForUser, usesPlatformKey } from "@/lib/runway-api-key";
import { getValidAccessToken, uploadFile } from "@/lib/dropbox";

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

  if (status === "error") {
    const job = await findJob(jobId, operationName);
    if (job) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorMessage: errorMsg ?? "Unknown error",
          completedAt: new Date(),
        },
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (status !== "ready" || !videoUri) {
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
      data: { status: "failed", errorMessage: "Unsupported model (only Runway)", completedAt: new Date() },
    });
    return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
  }

  const apiKey = await getRunwayApiKeyForUser(user?.runwayApiKey ?? null);
  if (!apiKey) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: "No Runway API key available", completedAt: new Date() },
    });
    return NextResponse.json({ error: "No API key" }, { status: 500 });
  }

  const destPath = template?.dropboxDestinationPath;
  if (!destPath) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "failed",
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
        status: "failed",
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
        status: "failed",
        errorMessage: "Dropbox not connected",
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: "Dropbox not connected" }, { status: 500 });
  }

  const baseName = job.dropboxSourceFilePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "video";
  const outputFileName = `${baseName}-${Date.now()}.mp4`;
  const outputPath = destPath.endsWith("/") ? `${destPath}${outputFileName}` : `${destPath}/${outputFileName}`;

  const uploadResult = await uploadFile(token, outputPath, videoBuffer, { mode: "add" });
  if (!uploadResult) {
    console.error("[webhook/job] Upload failed", {
      jobId: job.id,
      outputPath,
      destinationPath: destPath,
    });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage: "Failed to upload to Dropbox",
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
          kind: "spend",
          description: "Video generation",
        },
      });
    }
    await tx.job.update({
      where: { id: job.id },
      data: {
        status: "completed",
        outputDropboxPath: uploadResult.path_display ?? outputPath,
        completedAt: new Date(),
        apiCost: new Prisma.Decimal(apiCost),
        creditCost: new Prisma.Decimal(creditCost),
      },
    });
  });

  return NextResponse.json({ ok: true, outputDropboxPath: outputPath });
}

async function findJob(
  jobId: string | undefined,
  operationName: string | undefined
) {
  if (jobId) {
    const byId = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, userId: true, templateId: true, dropboxSourceFilePath: true, preGenImageKey: true },
    });
    if (byId) return byId;
  }
  if (operationName) {
    const byOp = await prisma.job.findFirst({
      where: { providerOperationId: operationName },
      select: { id: true, userId: true, templateId: true, dropboxSourceFilePath: true, preGenImageKey: true },
    });
    return byOp ?? null;
  }
  return null;
}
