/**
 * Vercel Workflow: one durable run per job.
 * Replaces GCP Cloud Tasks + AWS Step Function: process job, poll until done, then webhook.
 * Rate limiting: we retry with sleep in the workflow (no step retry limit); fatal errors call webhook and exit.
 */

import { sleep } from "workflow";
import { processJob } from "@/lib/process-job";

export type ProcessStepResult =
  | { ok: true; operationName: string }
  | { ok: false; retryable: true }
  | { ok: false; retryable: false; error: string };

async function runProcessJobStep(jobId: string): Promise<ProcessStepResult> {
  "use step";

  const result = await processJob(jobId, { skipRateLimit: false });
  if (result.ok) {
    return { ok: true, operationName: result.operationName };
  }
  if (result.error === "rate_limit") {
    return { ok: false, retryable: true };
  }
  return { ok: false, retryable: false, error: result.error };
}

async function checkJobStatusStep(
  baseUrl: string,
  jobId: string,
  operationName: string
): Promise<{ done: boolean; videoUri?: string; error?: string }> {
  "use step";

  const url = `${baseUrl.replace(/\/$/, "")}/api/job-status`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, operationName }),
  });
  if (!res.ok) {
    throw new Error(`job-status failed: ${res.status}`);
  }
  return res.json() as Promise<{ done: boolean; videoUri?: string; error?: string }>;
}

async function webhookJobStep(
  baseUrl: string,
  body: {
    status: "ready" | "error";
    jobId: string;
    operationName?: string;
    videoUri?: string;
    error?: string;
  }
): Promise<void> {
  "use step";

  const url = `${baseUrl.replace(/\/$/, "")}/api/webhook/job`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`webhook/job failed: ${res.status} ${await res.text()}`);
  }
}

export async function jobWorkflow(jobId: string, callbackBaseUrl: string): Promise<void> {
  "use workflow";

  let operationName: string;
  for (;;) {
    const stepResult = await runProcessJobStep(jobId);
    if (stepResult.ok) {
      operationName = stepResult.operationName;
      break;
    }
    if (stepResult.retryable) {
      await sleep("15 seconds");
      continue;
    }
    await webhookJobStep(callbackBaseUrl, {
      status: "error",
      jobId,
      error: stepResult.error,
    });
    return;
  }

  for (;;) {
    const status = await checkJobStatusStep(callbackBaseUrl, jobId, operationName);

    if (status.done && status.videoUri) {
      await webhookJobStep(callbackBaseUrl, {
        status: "ready",
        jobId,
        operationName,
        videoUri: status.videoUri,
      });
      return;
    }
    if (status.done && status.error) {
      await webhookJobStep(callbackBaseUrl, {
        status: "error",
        jobId,
        operationName,
        error: status.error,
      });
      return;
    }

    await sleep("5 seconds");
  }
}
