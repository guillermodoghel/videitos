import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const DEFAULT_PER_PAGE = 10;
const MIN_PER_PAGE = 5;
const MAX_PER_PAGE = 100;

/**
 * GET /api/jobs
 * Returns the current user's jobs with template name for the Jobs page.
 * Query: page (1-based), perPage (default 20). Returns jobs, total, page, perPage.
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

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        template: { select: { name: true, model: true } },
      },
    }),
    prisma.job.count({ where: { userId } }),
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
    createdAt: j.createdAt.toISOString(),
    sentAt: j.sentAt?.toISOString() ?? null,
    completedAt: j.completedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({ jobs: list, total, page, perPage });
}
