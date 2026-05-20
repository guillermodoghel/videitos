import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseRetakePromptBody } from "@/lib/job-config-override";
import { rerunJob } from "@/lib/rerun-job";
import { USER_ROLE } from "@/lib/constants/user-role";

/**
 * POST /api/jobs/[id]/retake
 * Re-run a completed job with the same source image (new video output).
 * Optional JSON body: { "prompt": "..." } overrides the template video prompt for this run.
 */
export async function POST(
  request: NextRequest,
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

  let body: unknown = null;
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as unknown;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseRetakePromptBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await rerunJob(jobId, "retake", {
    configOverride: parsed.override.prompt ? parsed.override : null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, jobId: result.jobId });
}
