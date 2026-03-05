import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getVeoOperationStatus } from "@/lib/veo";
import { getRunwayTaskStatus } from "@/lib/runway";
import { isRunwayImageToVideoModel } from "@/lib/video-models";

/**
 * POST /api/job-status
 * Called by Step Function (via callback Lambda). Body: { operationName, jobId? }.
 * Returns { done, videoUri? } or { done, error? } so the Step Function can branch.
 * Dispatches to Veo or Runway based on job's template model; operationName is Veo operation name or Runway task id.
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
      const user = await prisma.user.findUnique({
        where: { id: job.userId },
        select: { googleAiStudioApiKey: true, runwayApiKey: true },
      });
      apiKey = isRunway ? (user?.runwayApiKey ?? null) : (user?.googleAiStudioApiKey ?? null);
    }
  }

  if (!apiKey) {
    return NextResponse.json(
      { done: true, error: "Missing API key (jobId not found or user has no key)" },
      { status: 200 }
    );
  }

  try {
    const status = isRunway
      ? await getRunwayTaskStatus(apiKey, operationName)
      : await getVeoOperationStatus(apiKey, operationName);
    return NextResponse.json(status);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[job-status] unexpected error", {
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
