import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startJobWorkflow } from "@/lib/start-job-workflow";
import { JOB_STATUS } from "@/lib/constants/job-status";

const HOSTNAME = process.env.HOSTNAME ?? "http://localhost:3000";

/**
 * POST /api/jobs/start-execution
 * Start the job workflow (process + poll + webhook). Body: { jobId } (optional).
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

  const host = HOSTNAME.replace(/\/$/, "");
  const jobIdFromBody = body.jobId;

  if (jobIdFromBody && typeof jobIdFromBody === "string") {
    const job = await prisma.job.findUnique({
      where: { id: jobIdFromBody },
      select: { id: true, userId: true, status: true, template: { select: { model: true } } },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.status !== JOB_STATUS.QUEUED) {
      return NextResponse.json({ error: `Job not queued (status: ${job.status})` }, { status: 400 });
    }
    if (userId && job.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const started = await startJobWorkflow({
      jobId: job.id,
      callbackBaseUrl: host,
    });
    if (!started) {
      return NextResponse.json({ error: "Failed to start job workflow" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, jobId: job.id });
  }

  if (!userId) {
    return NextResponse.json({ error: "jobId required when not using session" }, { status: 400 });
  }

  // Start workflow for each queued job (rate limit enforced in workflow step retries)
  const queued = await prisma.job.findMany({
    where: { userId, status: JOB_STATUS.QUEUED },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, template: { select: { model: true } } },
  });
  if (queued.length === 0) {
    return NextResponse.json({ error: "No queued job found" }, { status: 404 });
  }

  let startedCount = 0;
  for (const job of queued) {
    const ok = await startJobWorkflow({
      jobId: job.id,
      callbackBaseUrl: host,
    });
    if (ok) startedCount++;
  }

  if (startedCount === 0) {
    return NextResponse.json({ error: "Failed to start job workflows" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobIds: queued.map((j) => j.id), enqueuedCount: startedCount });
}
