import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startJobWorkflow } from "@/lib/start-job-workflow";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { USER_ROLE } from "@/lib/constants/user-role";

const HOSTNAME = process.env.HOSTNAME ?? "http://localhost:3000";

/**
 * POST /api/jobs/[id]/retry
 * Reset a failed job (including canceled) to queued and start the workflow.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = sessionUser.role === USER_ROLE.ADMIN;

  const { id: jobId } = await params;
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, status: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!isAdmin && job.userId !== sessionUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (job.status !== JOB_STATUS.FAILED) {
    return NextResponse.json(
      { error: `Job cannot be retried (status: ${job.status})` },
      { status: 400 }
    );
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JOB_STATUS.QUEUED,
      errorMessage: null,
      completedAt: null,
      providerOperationId: null,
      sentAt: null,
      rateLimitClaimedAt: null,
    },
  });

  const callbackBaseUrl = HOSTNAME.replace(/\/$/, "");
  const started = await startJobWorkflow({
    jobId: job.id,
    callbackBaseUrl,
  });

  if (!started) {
    return NextResponse.json(
      { error: "Failed to start job workflow" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, jobId: job.id });
}
