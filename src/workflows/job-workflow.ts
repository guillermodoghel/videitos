/**
 * Vercel Workflow: one durable run per job.
 * Replaces GCP Cloud Tasks + AWS Step Function: process job, poll until done, then webhook.
 * Rate limiting: we retry with sleep in the workflow (no step retry limit); fatal errors call webhook and exit.
 */

import { sleep } from "workflow";
import { processJob } from "@/lib/process-job";
import { jobLog, jobLogError } from "@/lib/job-log";
import { WEBHOOK_JOB_STATUS } from "@/lib/constants/webhook-job-status";

export type ProcessStepResult =
  | { ok: true; operationName: string }
  | { ok: false; retryable: true }
  | { ok: false; retryable: false; error: string };

async function runProcessJobStep(jobId: string, attempt: number): Promise<ProcessStepResult> {
  "use step";

  jobLog("workflow:process", "step started", { jobId, attempt });
  const startedAt = Date.now();
  const result = await processJob(jobId, { skipRateLimit: false });
  const elapsedMs = Date.now() - startedAt;

  if (result.ok) {
    jobLog("workflow:process", "step succeeded", {
      jobId,
      attempt,
      operationName: result.operationName,
      elapsedMs,
    });
    return { ok: true, operationName: result.operationName };
  }
  if (result.error === "rate_limit") {
    jobLog("workflow:process", "step rate limited (will retry)", {
      jobId,
      attempt,
      elapsedMs,
    });
    return { ok: false, retryable: true };
  }
  jobLogError("workflow:process", "step failed (fatal)", {
    jobId,
    attempt,
    error: result.error,
    elapsedMs,
  });
  return { ok: false, retryable: false, error: result.error };
}

async function checkJobStatusStep(
  baseUrl: string,
  jobId: string,
  operationName: string,
  attempt: number
): Promise<{ done: boolean; videoUri?: string; error?: string }> {
  "use step";

  const url = `${baseUrl.replace(/\/$/, "")}/api/job-status`;
  jobLog("workflow:poll", "step started", { jobId, operationName, attempt, url });
  const startedAt = Date.now();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, operationName }),
  });
  const elapsedMs = Date.now() - startedAt;

  if (!res.ok) {
    jobLogError("workflow:poll", "job-status HTTP error", {
      jobId,
      operationName,
      attempt,
      status: res.status,
      elapsedMs,
    });
    throw new Error(`job-status failed: ${res.status}`);
  }

  const status = (await res.json()) as { done: boolean; videoUri?: string; error?: string };
  jobLog("workflow:poll", "step result", {
    jobId,
    operationName,
    attempt,
    done: status.done,
    hasVideoUri: !!status.videoUri,
    error: status.error ?? null,
    elapsedMs,
  });
  return status;
}

async function webhookJobStep(
  baseUrl: string,
  body: {
    status: typeof WEBHOOK_JOB_STATUS.READY | typeof WEBHOOK_JOB_STATUS.ERROR;
    jobId: string;
    operationName?: string;
    videoUri?: string;
    error?: string;
  }
): Promise<void> {
  "use step";

  const url = `${baseUrl.replace(/\/$/, "")}/api/webhook/job`;
  jobLog("workflow:webhook", "step started", {
    jobId: body.jobId,
    status: body.status,
    operationName: body.operationName ?? null,
    hasVideoUri: !!body.videoUri,
    error: body.error ?? null,
    url,
  });
  const startedAt = Date.now();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - startedAt;
  const responseText = res.ok ? undefined : await res.text();

  if (!res.ok) {
    jobLogError("workflow:webhook", "webhook HTTP error", {
      jobId: body.jobId,
      status: res.status,
      responsePreview: responseText?.slice(0, 300),
      elapsedMs,
    });
    throw new Error(`webhook/job failed: ${res.status} ${responseText}`);
  }

  jobLog("workflow:webhook", "step succeeded", {
    jobId: body.jobId,
    status: body.status,
    elapsedMs,
  });
}

export async function jobWorkflow(jobId: string, callbackBaseUrl: string): Promise<void> {
  "use workflow";

  const workflowStartedAt = Date.now();
  jobLog("workflow", "run started", { jobId, callbackBaseUrl });

  let operationName: string;
  let processAttempt = 0;
  for (;;) {
    processAttempt += 1;
    const stepResult = await runProcessJobStep(jobId, processAttempt);
    if (stepResult.ok) {
      operationName = stepResult.operationName;
      jobLog("workflow", "process phase complete", {
        jobId,
        operationName,
        processAttempts: processAttempt,
      });
      break;
    }
    if (stepResult.retryable) {
      jobLog("workflow", "sleeping before process retry", {
        jobId,
        processAttempt,
        sleep: "15 seconds",
      });
      await sleep("15 seconds");
      continue;
    }
    jobLogError("workflow", "run failed at process phase", {
      jobId,
      error: stepResult.error,
      processAttempts: processAttempt,
      elapsedMs: Date.now() - workflowStartedAt,
    });
    await webhookJobStep(callbackBaseUrl, {
      status: WEBHOOK_JOB_STATUS.ERROR,
      jobId,
      error: stepResult.error,
    });
    return;
  }

  let pollAttempt = 0;
  for (;;) {
    pollAttempt += 1;
    const status = await checkJobStatusStep(callbackBaseUrl, jobId, operationName, pollAttempt);

    if (status.done && status.videoUri) {
      jobLog("workflow", "poll phase complete — video ready", {
        jobId,
        operationName,
        pollAttempts: pollAttempt,
        elapsedMs: Date.now() - workflowStartedAt,
      });
      await webhookJobStep(callbackBaseUrl, {
        status: WEBHOOK_JOB_STATUS.READY,
        jobId,
        operationName,
        videoUri: status.videoUri,
      });
      jobLog("workflow", "run finished successfully", {
        jobId,
        operationName,
        totalElapsedMs: Date.now() - workflowStartedAt,
        processAttempts: processAttempt,
        pollAttempts: pollAttempt,
      });
      return;
    }
    if (status.done && status.error) {
      jobLogError("workflow", "poll phase failed", {
        jobId,
        operationName,
        error: status.error,
        pollAttempts: pollAttempt,
        elapsedMs: Date.now() - workflowStartedAt,
      });
      await webhookJobStep(callbackBaseUrl, {
        status: WEBHOOK_JOB_STATUS.ERROR,
        jobId,
        operationName,
        error: status.error,
      });
      jobLog("workflow", "run finished with provider error", {
        jobId,
        totalElapsedMs: Date.now() - workflowStartedAt,
      });
      return;
    }

    jobLog("workflow", "sleeping before next poll", {
      jobId,
      operationName,
      pollAttempt,
      sleep: "5 seconds",
    });
    await sleep("5 seconds");
  }
}
