import { jobLog, jobLogError } from "@/lib/job-log";

type StepFields = Record<string, unknown>;

/** Structured logs for workflow durable steps (filter in Vercel by `step`). */
export function workflowStepLog(
  step: string,
  message: string,
  fields?: StepFields
): void {
  jobLog("workflow:step", message, { step, ...fields });
}

export function workflowStepLogError(
  step: string,
  message: string,
  fields?: StepFields
): void {
  jobLogError("workflow:step", message, { step, ...fields });
}
