/**
 * Start the per-job Vercel Workflow (replaces enqueueJobTask + Step Function).
 * Call from API routes when a job is created or when user triggers "process queue".
 */

import { start } from "workflow/api";
import { jobWorkflow } from "@/workflows/job-workflow";

export async function startJobWorkflow(params: {
  jobId: string;
  callbackBaseUrl: string;
}): Promise<boolean> {
  const { jobId, callbackBaseUrl } = params;
  const base = callbackBaseUrl.replace(/\/$/, "");
  try {
    await start(jobWorkflow, [jobId, base]);
    return true;
  } catch (err) {
    console.error("[startJobWorkflow] start failed:", err);
    return false;
  }
}
