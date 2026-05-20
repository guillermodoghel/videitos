import type { ProcessJobResult } from "@/lib/process-job";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import {
  RATE_LIMIT_WORKFLOW_RETRY_SECONDS,
  RUNWAY_HIGH_LOAD_WORKFLOW_RETRY,
  RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY,
} from "@/lib/constants/job-retry";

/** JSON body returned by POST /api/jobs/workflow/process (and consumed by the workflow step). */
export type WorkflowProcessJobResponse =
  | { ok: true; operationName: string }
  | {
      ok: false;
      retryable: true;
      retryReason: "rate_limit" | "runway_insufficient_credits" | "runway_high_load";
      retryAfterSeconds: number;
    }
  | { ok: false; retryable: false; error: string };

export function mapProcessJobResultToWorkflowResponse(
  result: ProcessJobResult
): WorkflowProcessJobResponse {
  if (result.ok) {
    return { ok: true, operationName: result.operationName };
  }
  if (result.error === "rate_limit") {
    return {
      ok: false,
      retryable: true,
      retryReason: "rate_limit",
      retryAfterSeconds: RATE_LIMIT_WORKFLOW_RETRY_SECONDS,
    };
  }
  if (result.error === JOB_ERROR.RUNWAY_INSUFFICIENT_CREDITS_CODE) {
    return {
      ok: false,
      retryable: true,
      retryReason: "runway_insufficient_credits",
      retryAfterSeconds: RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY.intervalSeconds,
    };
  }
  if (result.error === JOB_ERROR.RUNWAY_HIGH_LOAD_CODE) {
    return {
      ok: false,
      retryable: true,
      retryReason: "runway_high_load",
      retryAfterSeconds: RUNWAY_HIGH_LOAD_WORKFLOW_RETRY.intervalSeconds,
    };
  }
  return { ok: false, retryable: false, error: result.error };
}
