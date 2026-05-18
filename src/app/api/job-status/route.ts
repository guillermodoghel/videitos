import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jobLog, jobLogError } from "@/lib/job-log";
import { getRunwayTaskStatus } from "@/lib/runway";
import { isRunwayImageToVideoModel } from "@/lib/video-models";
import { getRunwayApiKeyForUser } from "@/lib/runway-api-key";
import { persistRunwayVideoUri } from "@/lib/persist-runway-video-uri";
import { persistRunwayPollStatus } from "@/lib/persist-runway-poll-status";

/**
 * POST /api/job-status
 * Returns Runway task status. Only Runway is supported (operationName = Runway task id).
 */
export async function POST(request: NextRequest) {
  let body: { operationName?: string; jobId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const operationName = body.operationName;
  const jobId = body.jobId;

  jobLog("status", "request received", { jobId: jobId ?? null, operationName: operationName ?? null });

  if (!operationName || typeof operationName !== "string") {
    return NextResponse.json(
      { error: "operationName required" },
      { status: 400 }
    );
  }

  let apiKey: string | null = null;
  let isRunway = false;
  if (jobId) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { userId: true, template: { select: { model: true } } },
    });
    if (job) {
      isRunway = isRunwayImageToVideoModel(job.template.model);
      jobLog("status", "job resolved", {
        jobId,
        model: job.template.model,
        isRunway,
        userId: job.userId,
      });
      if (isRunway) {
        const user = await prisma.user.findUnique({
          where: { id: job.userId },
          select: { runwayApiKey: true },
        });
        apiKey = await getRunwayApiKeyForUser(user?.runwayApiKey ?? null);
      }
    }
  }

  if (!isRunway || !apiKey) {
    jobLogError("status", "unsupported or missing API key", { jobId, operationName, isRunway, hasApiKey: !!apiKey });
    return NextResponse.json(
      { done: true, error: "Unsupported model or missing Runway API key" },
      { status: 200 }
    );
  }

  try {
    const startedAt = Date.now();
    const status = await getRunwayTaskStatus(apiKey, operationName);
    if (jobId) {
      await persistRunwayPollStatus(jobId, {
        progress: status.progress,
        runwayStatus: status.runwayStatus,
      });
    }
    if (status.done && status.videoUri && jobId) {
      await persistRunwayVideoUri(jobId, status.videoUri);
    }
    jobLog("status", "Runway task status", {
      jobId,
      operationName,
      runwayStatus: status.runwayStatus ?? null,
      progress: status.progress ?? null,
      done: status.done,
      hasVideoUri: !!status.videoUri,
      error: status.error ?? null,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json(status);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    jobLogError("status", "unexpected error", {
      jobId,
      operationName,
      message: err.message,
      stack: err.stack,
    });
    return NextResponse.json(
      {
        done: true,
        error: `Status check failed: ${err.message}`,
      },
      { status: 200 }
    );
  }
}
