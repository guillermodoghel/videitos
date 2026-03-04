import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/jobs
 * Returns the current user's jobs with template name for the Jobs page.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await prisma.job.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      template: { select: { name: true } },
    },
  });

  const list = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    templateName: j.template.name,
    dropboxSourceFilePath: j.dropboxSourceFilePath,
    outputDropboxPath: j.outputDropboxPath,
    errorMessage: j.errorMessage,
    createdAt: j.createdAt.toISOString(),
    sentToVeoAt: j.sentToVeoAt?.toISOString() ?? null,
    completedAt: j.completedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({ jobs: list });
}
