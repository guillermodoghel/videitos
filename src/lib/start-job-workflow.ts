/**
 * Start the per-job Vercel Workflow (replaces enqueueJobTask + Step Function).
 * Call from API routes when a job is created or when user triggers "process queue".
 */

import { start } from "workflow/api";
import { jobWorkflow } from "@/workflows/job-workflow";
import { jobLog, jobLogError } from "@/lib/job-log";

export async function startJobWorkflow(params: {
  jobId: string;
  callbackBaseUrl: string;
}): Promise<boolean> {
  const { jobId, callbackBaseUrl } = params;
  const base = callbackBaseUrl.replace(/\/$/, "");
  jobLog("start", "starting workflow", { jobId, callbackBaseUrl: base });
  try {
    await start(jobWorkflow, [jobId, base]);
    jobLog("start", "workflow started", { jobId });
    return true;
  } catch (err) {
    jobLogError("start", "workflow start failed", {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
