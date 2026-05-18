import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { USER_ROLE } from "@/lib/constants/user-role";
import { cancelJobWorkflowRun } from "@/lib/cancel-job-workflow-run";
import { cancelRunwayTaskForJob } from "@/lib/cancel-runway-task-for-job";
import { isJobCanceled } from "@/lib/is-job-canceled";

/**
 * POST /api/jobs/[id]/cancel
 * Marks the job canceled, cancels the Runway task when running, and stops the workflow.
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
    select: { id: true, userId: true, status: true, errorMessage: true, workflowRunId: true },
  });

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!isAdmin && job.userId !== sessionUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (job.status === JOB_STATUS.COMPLETED) {
    return NextResponse.json({ error: "Cannot cancel a completed job" }, { status: 400 });
  }
  if (isJobCanceled(job.errorMessage)) {
    return NextResponse.json({ ok: true, jobId: job.id });
  }
  const isCancellable =
    job.status === JOB_STATUS.QUEUED ||
    job.status === JOB_STATUS.PROCESSING ||
    job.status === JOB_STATUS.SENT_TO_VEO;

  if (!isCancellable) {
    return NextResponse.json({ error: `Cannot cancel job in status: ${job.status}` }, { status: 400 });
  }

  const workflowRunId = job.workflowRunId;

  await cancelRunwayTaskForJob(jobId);

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JOB_STATUS.FAILED,
      errorMessage: JOB_ERROR.CANCELED,
      completedAt: new Date(),
      providerOperationId: null,
      sentAt: null,
      rateLimitClaimedAt: null,
      outputDropboxPath: null,
      workflowPhase: null,
      runwayProgress: null,
      runwayPollStatus: null,
      apiCost: null,
      creditCost: null,
    },
  });

  await cancelJobWorkflowRun(workflowRunId);

  return NextResponse.json({ ok: true, jobId: jobId });
}

