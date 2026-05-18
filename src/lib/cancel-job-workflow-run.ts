import { getRun } from "workflow/api";
import { jobLog, jobLogError } from "@/lib/job-log";

/** Stops the Vercel Workflow run for a job. Best-effort if the run already finished. */
export async function cancelJobWorkflowRun(workflowRunId: string | null | undefined): Promise<void> {
  const runId = workflowRunId?.trim();
  if (!runId) return;

  try {
    const run = getRun(runId);
    await run.cancel();
    jobLog("workflow:cancel", "workflow run cancelled", { workflowRunId: runId });
  } catch (err) {
    jobLogError("workflow:cancel", "workflow cancel failed (run may already be finished)", {
      workflowRunId: runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
