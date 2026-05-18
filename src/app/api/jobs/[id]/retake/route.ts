import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rerunJob } from "@/lib/rerun-job";
import { USER_ROLE } from "@/lib/constants/user-role";

/**
 * POST /api/jobs/[id]/retake
 * Re-run a completed job with the same source image (new video output).
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
    select: { id: true, userId: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!isAdmin && job.userId !== sessionUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await rerunJob(jobId, "retake");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, jobId: result.jobId });
}
