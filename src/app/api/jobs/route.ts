import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";

const DEFAULT_PER_PAGE = 10;
const MIN_PER_PAGE = 5;
const MAX_PER_PAGE = 100;

/**
 * GET /api/jobs
 * Returns the current user's jobs with template name for the Jobs page.
 * Query: page (1-based), perPage (default 20), model (template model id), status (job status).
 * Returns jobs, total, page, perPage.
 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  let perPage = parseInt(searchParams.get("perPage") ?? String(DEFAULT_PER_PAGE), 10) || DEFAULT_PER_PAGE;
  perPage = Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, perPage));
  const model = searchParams.get("model")?.trim() || null;
  const status = searchParams.get("status")?.trim() || null;

  const where = {
    userId,
    ...(status ? { status } : {}),
    ...(model ? { template: { model } } : {}),
  };

  const activeStatuses = [JOB_STATUS.QUEUED, JOB_STATUS.PROCESSING, JOB_STATUS.SENT_TO_VEO];

  const [jobs, total, activeCount] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        template: { select: { name: true, model: true } },
      },
    }),
    prisma.job.count({ where }),
    prisma.job.count({
      where: { userId, status: { in: activeStatuses } },
    }),
  ]);

  const list = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    templateName: j.template.name,
    model: j.template.model,
    dropboxSourceFilePath: j.dropboxSourceFilePath,
    outputDropboxPath: j.outputDropboxPath,
    preGenImageKey: j.preGenImageKey ?? null,
    errorMessage: j.errorMessage,
    apiCost: j.apiCost != null ? Number(j.apiCost) : null,
    creditCost: j.creditCost != null ? Number(j.creditCost) : null,
    createdAt: j.createdAt.toISOString(),
    sentAt: j.sentAt?.toISOString() ?? null,
    completedAt: j.completedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({
    jobs: list,
    total,
    page,
    perPage,
    /** True if user has any job queued or in progress; frontend uses this to decide whether to keep polling. */
    hasActiveJobs: activeCount > 0,
  });
}
