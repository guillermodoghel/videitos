import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { WEBHOOK_JOB_STATUS } from "@/lib/constants/webhook-job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { jobLog, jobLogError } from "@/lib/job-log";
import { completeJobWithRunwayVideo } from "@/lib/complete-job-with-runway-video";

/** Must return before Vercel 300s limit; Dropbox 429 defers to workflow (no long sleeps here). */
export const maxDuration = 120;

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
        return NextResponse.json({ ok: true, jobCompleted: false, skipped: true });
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
          workflowPhase: null,
          completedAt: new Date(),
        },
      });
    }
    return NextResponse.json({ ok: true, jobCompleted: false });
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

  const result = await completeJobWithRunwayVideo({
    jobId: job.id,
    videoUri,
    operationName,
    source: "webhook/job",
  });

  if (result.outcome === "completed") {
    return NextResponse.json({
      ok: true,
      jobCompleted: true,
      outputDropboxPath: result.outputDropboxPath,
    });
  }
  if (result.outcome === "already_completed") {
    return NextResponse.json({
      ok: true,
      jobCompleted: true,
      skipped: true,
      outputDropboxPath: result.outputDropboxPath,
    });
  }
  if (result.outcome === "skipped") {
    jobLog("webhook", "ready callback skipped", {
      jobId: job.id,
      reason: result.reason,
    });
    return NextResponse.json({
      ok: true,
      jobCompleted: false,
      skipped: true,
      reason: result.reason,
    });
  }
  if (result.outcome === "dropbox_rate_limited") {
    jobLog("webhook", "Dropbox rate limited — workflow will retry", {
      jobId: job.id,
      retryAfterSeconds: result.retryAfterSeconds,
    });
    return NextResponse.json({
      ok: true,
      jobCompleted: false,
      retryable: true,
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }

  return NextResponse.json(
    { ok: false, jobCompleted: false, error: result.error },
    { status: 500 }
  );
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
        outputDropboxPath: true,
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
        outputDropboxPath: true,
        dropboxSourceFilePath: true,
        preGenImageKey: true,
      },
    });
    if (byOp) return byOp;
  }
  return null;
}
