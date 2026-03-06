import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processJob } from "@/lib/process-job";

/**
 * POST /api/jobs/claim-and-process
 * Called by the Step Function (via callback Lambda). Body: { jobId }.
 * If rate limit allows: runs the job (provider + update DB), returns { success: true, operationName }.
 * Otherwise returns { success: false }. Step Function will wait and retry.
 * On fatal errors we set job to failed and return { success: false, fatal: true, error } so the Step Function can callback and end.
 * Auth: x-internal-secret or Authorization must match JOB_PROCESS_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret =
    request.headers.get("x-internal-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.JOB_PROCESS_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { jobId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobId = body.jobId;
  if (!jobId || typeof jobId !== "string") {
    console.log("[claim-and-process] Missing jobId");
    return NextResponse.json(
      { success: false, fatal: false, error: "jobId required" },
      { status: 200 }
    );
  }

  try {
    const result = await processJob(jobId);

    if (result.ok) {
      console.log("[claim-and-process] jobId=%s success → operationName=%s", jobId, result.operationName);
      return NextResponse.json({
        success: true,
        fatal: false,
        operationName: result.operationName,
      });
    }
    // Stop retrying: job not found (stale), no API key, insufficient credits, or job already failed
    const fatal =
      result.error === "Job not found" ||
      result.error === "No API key" ||
      result.error === "insufficient_credits" ||
      result.error.startsWith("Job not queued (status: failed)");
    console.log("[claim-and-process] jobId=%s %s → error=%s", jobId, fatal ? "fatal" : "retry", result.error);
    return NextResponse.json(
      { success: false, fatal, error: result.error },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job.updateMany({
      where: { id: jobId, status: "queued" },
      data: {
        status: "failed",
        errorMessage: message.slice(0, 1000),
        completedAt: new Date(),
      },
    });
    console.log("[claim-and-process] jobId=%s fatal → error=%s", jobId, message);
    return NextResponse.json(
      { success: false, fatal: true, error: message },
      { status: 200 }
    );
  }
}
