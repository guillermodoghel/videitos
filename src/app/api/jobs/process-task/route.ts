import { NextRequest, NextResponse } from "next/server";
import { processJobToVeo } from "@/lib/process-job";
import { startJobStepFunction } from "@/lib/step-function";

/**
 * POST /api/jobs/process-task
 * Called by Google Cloud Tasks. Body: { jobId, callbackBaseUrl }.
 * Runs the job (download + Veo). On success starts Step Function to poll and callback.
 * On Veo rate limit returns 429 so Cloud Tasks retries. On other error marks job failed and returns 200.
 * Auth: X-Job-Process-Secret or Authorization must match JOB_PROCESS_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret =
    request.headers.get("x-job-process-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.JOB_PROCESS_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { jobId?: string; callbackBaseUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobId = body.jobId;
  const callbackBaseUrl = body.callbackBaseUrl;
  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  if (!callbackBaseUrl || typeof callbackBaseUrl !== "string") {
    return NextResponse.json({ error: "callbackBaseUrl required" }, { status: 400 });
  }

  const result = await processJobToVeo(jobId, { skipRateLimit: true });

  if (result.ok) {
    const started = await startJobStepFunction({
      callbackBaseUrl: callbackBaseUrl.replace(/\/$/, ""),
      jobId,
      operationName: result.operationName,
    });
    if (!started) {
      console.error("[process-task] Step Function start failed for jobId=%s", jobId);
    }
    return NextResponse.json({ success: true, operationName: result.operationName });
  }

  if (result.error === "rate_limit") {
    return NextResponse.json(
      { error: "rate_limit", retry: true },
      { status: 429 }
    );
  }

  return NextResponse.json({ success: false, error: result.error });
}
