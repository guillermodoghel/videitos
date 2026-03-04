import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startJobStepFunction } from "@/lib/step-function";

const HOSTNAME = process.env.HOSTNAME ?? "http://localhost:3000";

/**
 * POST /api/jobs/start-execution
 * Start the Step Function for a queued job. Body: { jobId } (optional; if omitted, starts oldest queued job for current user).
 * Auth: session (user) or x-internal-secret / Authorization (JOB_PROCESS_SECRET).
 */
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  const secret =
    request.headers.get("x-internal-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expectedSecret = process.env.JOB_PROCESS_SECRET;
  const allowedBySession = !!userId;
  const allowedBySecret = !!expectedSecret && secret === expectedSecret;

  if (!allowedBySession && !allowedBySecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { jobId?: string };
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  let jobId = body.jobId;
  if (!jobId || typeof jobId !== "string") {
    if (!userId) {
      return NextResponse.json({ error: "jobId required when not using session" }, { status: 400 });
    }
    const first = await prisma.job.findFirst({
      where: { userId, status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!first) {
      return NextResponse.json({ error: "No queued job found" }, { status: 404 });
    }
    jobId = first.id;
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, status: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "queued") {
    return NextResponse.json({ error: `Job not queued (status: ${job.status})` }, { status: 400 });
  }
  if (userId && job.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const started = await startJobStepFunction({
    callbackBaseUrl: HOSTNAME.replace(/\/$/, ""),
    jobId: job.id,
  });

  if (!started) {
    return NextResponse.json({ error: "Failed to start Step Function" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobId: job.id });
}
