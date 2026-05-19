import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { USER_ROLE } from "@/lib/constants/user-role";
import { jobCanRetryDropboxUpload } from "@/lib/resolve-runway-video-uri";

const MAX_IDS = 50;

/**
 * GET /api/jobs/live?ids=id1,id2
 * Lightweight status poll for active jobs on the current page (no reconcile/heal).
 */
export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = sessionUser.id;
  const isAdmin = sessionUser.role === USER_ROLE.ADMIN;
  const idsParam = new URL(request.url).searchParams.get("ids")?.trim() ?? "";
  const ids = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return NextResponse.json({ jobs: [], hasActiveJobs: false });
  }

  const activeStatuses = [JOB_STATUS.QUEUED, JOB_STATUS.PROCESSING, JOB_STATUS.SENT_TO_VEO];

  const [jobs, activeCount] = await Promise.all([
    prisma.job.findMany({
      where: {
        id: { in: ids },
        ...(isAdmin ? {} : { userId }),
      },
      select: {
        id: true,
        status: true,
        workflowPhase: true,
        runwayProgress: true,
        runwayPollStatus: true,
        errorMessage: true,
        dropboxUploadErrorDetail: true,
        providerOperationId: true,
        outputDropboxPath: true,
        runwayOutputVideoUri: true,
        apiCost: true,
        creditCost: true,
        completedAt: true,
      },
    }),
    prisma.job.count({
      where: {
        ...(isAdmin ? {} : { userId }),
        status: { in: activeStatuses },
      },
    }),
  ]);

  const list = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    workflowPhase: j.workflowPhase,
    runwayProgress: j.runwayProgress != null ? Number(j.runwayProgress) : null,
    runwayPollStatus: j.runwayPollStatus,
    errorMessage: j.errorMessage,
    dropboxUploadErrorDetail: j.dropboxUploadErrorDetail,
    providerOperationId: j.providerOperationId,
    outputDropboxPath: j.outputDropboxPath,
    canRetryDropboxUpload: jobCanRetryDropboxUpload({
      status: j.status,
      errorMessage: j.errorMessage,
      dropboxUploadErrorDetail: j.dropboxUploadErrorDetail,
      runwayOutputVideoUri: j.runwayOutputVideoUri,
      providerOperationId: j.providerOperationId,
    }),
    apiCost: j.apiCost != null ? Number(j.apiCost) : null,
    creditCost: j.creditCost != null ? Number(j.creditCost) : null,
    completedAt: j.completedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({
    jobs: list,
    hasActiveJobs: activeCount > 0,
  });
}
