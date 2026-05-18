import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getTemporaryLink } from "@/lib/dropbox";
import { JOB_STATUS } from "@/lib/constants/job-status";
import { USER_ROLE } from "@/lib/constants/user-role";

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
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = sessionUser.id;
  const isAdmin = sessionUser.role === USER_ROLE.ADMIN;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  let perPage = parseInt(searchParams.get("perPage") ?? String(DEFAULT_PER_PAGE), 10) || DEFAULT_PER_PAGE;
  perPage = Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, perPage));
  const model = searchParams.get("model")?.trim() || null;
  const status = searchParams.get("status")?.trim() || null;
  const userQuery = searchParams.get("user")?.trim() || null;

  const where = {
    ...(isAdmin ? {} : { userId }),
    ...(status ? { status } : {}),
    ...(model ? { template: { model } } : {}),
    ...(isAdmin && userQuery
      ? {
          OR: [
            { user: { email: { contains: userQuery, mode: "insensitive" as const } } },
            { userId: { contains: userQuery, mode: "insensitive" as const } },
          ],
        }
      : {}),
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
        user: { select: { email: true } },
      },
    }),
    prisma.job.count({ where }),
    prisma.job.count({
      where: {
        ...(isAdmin ? {} : { userId }),
        status: { in: activeStatuses },
        ...(isAdmin && userQuery
          ? {
              OR: [
                { user: { email: { contains: userQuery, mode: "insensitive" as const } } },
                { userId: { contains: userQuery, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
    }),
  ]);

  const thumbnailByJobId = await resolveSourceThumbnails(jobs);

  const list = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    templateName: j.template.name,
    userEmail: j.user.email,
    userId: j.userId,
    model: j.template.model,
    dropboxSourceFilePath: j.dropboxSourceFilePath,
    sourceThumbnailUrl: thumbnailByJobId.get(j.id) ?? null,
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
    isAdmin,
  });
}

/**
 * DELETE /api/jobs
 * Body: { jobIds: string[] }
 * Deletes only failed jobs that belong to the current user. Returns { deleted: number }.
 */
export async function DELETE(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { jobIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawIds = Array.isArray(body.jobIds) ? body.jobIds : [];
  const jobIds = rawIds.filter((id) => typeof id === "string" && id.trim().length > 0);
  if (jobIds.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  const result = await prisma.job.deleteMany({
    where: {
      id: { in: jobIds },
      userId,
      status: JOB_STATUS.FAILED,
    },
  });

  return NextResponse.json({ deleted: result.count });
}

type JobForThumbnail = {
  id: string;
  userId: string;
  dropboxSourceFilePath: string;
  dropboxSourceFileId: string | null;
};

function dropboxSourcePathOrId(job: JobForThumbnail): string {
  if (job.dropboxSourceFileId) {
    return job.dropboxSourceFileId.startsWith("id:")
      ? job.dropboxSourceFileId
      : `id:${job.dropboxSourceFileId}`;
  }
  return job.dropboxSourceFilePath;
}

async function resolveSourceThumbnails(
  jobs: JobForThumbnail[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (jobs.length === 0) return out;

  const byUser = new Map<string, JobForThumbnail[]>();
  for (const job of jobs) {
    const list = byUser.get(job.userId) ?? [];
    list.push(job);
    byUser.set(job.userId, list);
  }

  await Promise.all(
    [...byUser.entries()].map(async ([userId, userJobs]) => {
      const token = await getValidAccessToken(userId);
      if (!token) return;
      await Promise.all(
        userJobs.map(async (job) => {
          const link = await getTemporaryLink(token, dropboxSourcePathOrId(job));
          if (link?.link) out.set(job.id, link.link);
        })
      );
    })
  );

  return out;
}
