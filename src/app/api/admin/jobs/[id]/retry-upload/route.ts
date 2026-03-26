import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startJobWorkflow } from "@/lib/start-job-workflow";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { USER_ROLE } from "@/lib/constants/user-role";

const HOSTNAME = process.env.HOSTNAME ?? "http://localhost:3000";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== USER_ROLE.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await params;
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, errorMessage: true },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status !== JOB_STATUS.FAILED) {
    return NextResponse.json(
      { error: `Job cannot be retried (status: ${job.status})` },
      { status: 400 }
    );
  }
  if (job.errorMessage !== JOB_ERROR.DROPBOX_UPLOAD_FAILED) {
    return NextResponse.json(
      { error: "This endpoint only retries Dropbox upload failures" },
      { status: 400 }
    );
  }

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: JOB_STATUS.QUEUED,
      errorMessage: null,
      completedAt: null,
      providerOperationId: null,
      sentAt: null,
      rateLimitClaimedAt: null,
      outputDropboxPath: null,
      apiCost: null,
      creditCost: null,
    },
  });

  const started = await startJobWorkflow({
    jobId: job.id,
    callbackBaseUrl: HOSTNAME.replace(/\/$/, ""),
  });
  if (!started) {
    return NextResponse.json({ error: "Failed to start workflow" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobId: job.id });
}
