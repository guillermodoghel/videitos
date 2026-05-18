import { NextRequest, NextResponse } from "next/server";
import { processJob } from "@/lib/process-job";
import { jobLog, jobLogError } from "@/lib/job-log";
import { verifyJobProcessSecret } from "@/lib/verify-job-process-secret";
import { mapProcessJobResultToWorkflowResponse } from "@/lib/workflow-process-job-response";

/** Runway submit + Dropbox download / pre-gen can exceed the default 10s on Pro. */
export const maxDuration = 300;

/**
 * POST /api/jobs/workflow/process
 * Called by the job workflow step. Runs processJob and returns a structured result for retries.
 * Auth: x-internal-secret or Authorization must match JOB_PROCESS_SECRET.
 */
export async function POST(request: NextRequest) {
  if (!verifyJobProcessSecret(request)) {
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
    jobLogError("workflow:process", "missing jobId", {});
    return NextResponse.json(
      { ok: false, retryable: false, error: "jobId required" },
      { status: 400 }
    );
  }

  const startedAt = Date.now();
  jobLog("workflow:process", "request received", { jobId });

  try {
    const result = await processJob(jobId, { skipRateLimit: false });
    const response = mapProcessJobResultToWorkflowResponse(result);
    const elapsedMs = Date.now() - startedAt;

    if (response.ok) {
      jobLog("workflow:process", "request succeeded", {
        jobId,
        operationName: response.operationName,
        elapsedMs,
      });
    } else if (response.retryable) {
      jobLog("workflow:process", "request retryable", {
        jobId,
        retryReason: response.retryReason,
        retryAfterSeconds: response.retryAfterSeconds,
        elapsedMs,
      });
    } else {
      jobLogError("workflow:process", "request failed (fatal)", {
        jobId,
        error: response.error,
        elapsedMs,
      });
    }

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobLogError("workflow:process", "unexpected error", {
      jobId,
      error: message,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { ok: false, retryable: false, error: message },
      { status: 200 }
    );
  }
}
