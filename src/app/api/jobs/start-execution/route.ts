import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueJobTask } from "@/lib/cloud-tasks";

const HOSTNAME = process.env.HOSTNAME ?? "http://localhost:3000";

/**
 * POST /api/jobs/start-execution
 * Enqueue a queued job to Cloud Tasks (so it gets processed and Step Function runs). Body: { jobId } (optional).
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
    select: { id: true, userId: true, status: true, template: { select: { model: true } } },
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

  const enqueued = await enqueueJobTask({
    userId: job.userId,
    modelId: job.template.model,
    jobId: job.id,
    callbackBaseUrl: HOSTNAME.replace(/\/$/, ""),
  });

  if (!enqueued) {
    return NextResponse.json({ error: "Failed to enqueue job (check GCP config)" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobId: job.id });
}
