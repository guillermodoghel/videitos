/**
 * Vercel Workflow: one durable run per job.
 * Replaces GCP Cloud Tasks + AWS Step Function: process job, poll until done, then webhook.
 * Rate limiting: we retry with sleep in the workflow (no step retry limit); fatal errors call webhook and exit.
 */

import { sleep } from "workflow";
import {
  processJob,
  markJobFailedRunwayInsufficientCredits,
  resetJobForRunwayCreditsRetry,
} from "@/lib/process-job";
import { jobLog, jobLogError } from "@/lib/job-log";
import { isRunwayInsufficientCreditsError } from "@/lib/runway-errors";
import { WEBHOOK_JOB_STATUS } from "@/lib/constants/webhook-job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { JOB_WORKFLOW_PHASE } from "@/lib/constants/job-workflow-phase";
import { setJobWorkflowPhase } from "@/lib/set-job-workflow-phase";
import {
  RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY,
  RATE_LIMIT_WORKFLOW_RETRY_SECONDS,
  DROPBOX_UPLOAD_WORKFLOW_RETRY,
} from "@/lib/constants/job-retry";

export type ProcessStepResult =
  | { ok: true; operationName: string }
  | {
      ok: false;
      retryable: true;
      retryReason: "rate_limit" | "runway_insufficient_credits";
      retryAfterSeconds: number;
    }
  | { ok: false; retryable: false; error: string };

async function workflowPhase_step(
  jobId: string,
  phase: (typeof JOB_WORKFLOW_PHASE)[keyof typeof JOB_WORKFLOW_PHASE]
): Promise<void> {
  "use step";
  await setJobWorkflowPhase(jobId, phase);
}

async function processJob_step(jobId: string, attempt: number): Promise<ProcessStepResult> {
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
    return {
      ok: false,
      retryable: true,
      retryReason: "rate_limit",
      retryAfterSeconds: RATE_LIMIT_WORKFLOW_RETRY_SECONDS,
    };
  }
  if (result.error === JOB_ERROR.RUNWAY_INSUFFICIENT_CREDITS_CODE) {
    jobLog("workflow:process", "Runway out of credits (will retry)", {
      jobId,
      attempt,
      elapsedMs,
      retryAfterSeconds: RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY.intervalSeconds,
    });
    return {
      ok: false,
      retryable: true,
      retryReason: "runway_insufficient_credits",
      retryAfterSeconds: RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY.intervalSeconds,
    };
  }
  jobLogError("workflow:process", "step failed (fatal)", {
    jobId,
    attempt,
    error: result.error,
    elapsedMs,
  });
  return { ok: false, retryable: false, error: result.error };
}

async function workflowWait_rateLimit_step(
  jobId: string,
  attempt: number,
  sleepSeconds: number
): Promise<void> {
  "use step";
  jobLog("workflow:wait", "rate limit wait", { jobId, attempt, sleepSeconds });
  await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.WAITING_RATE_LIMIT);
}

async function workflowWait_runwayCredits_step(
  jobId: string,
  attempt: number,
  sleepSeconds: number
): Promise<void> {
  "use step";
  jobLog("workflow:wait", "Runway credits wait", { jobId, attempt, sleepSeconds });
  await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.WAITING_RUNWAY_CREDITS);
}

async function workflowWait_poll_step(
  jobId: string,
  operationName: string,
  pollAttempt: number
): Promise<void> {
  "use step";
  jobLog("workflow:wait", "poll wait", { jobId, operationName, pollAttempt });
  await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.POLLING);
}

async function failRunwayInsufficientCredits_step(jobId: string): Promise<void> {
  "use step";
  await markJobFailedRunwayInsufficientCredits(jobId);
}

async function resetRunwayCreditsRetry_step(jobId: string): Promise<void> {
  "use step";
  await resetJobForRunwayCreditsRetry(jobId);
}

async function pollRunwayTask_step(
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

type WebhookStepResult =
  | { jobCompleted: true }
  | { jobCompleted: false; retryable: true; retryAfterSeconds: number }
  | { jobCompleted: false; skipped?: boolean; reason?: string };

async function workflowWait_dropboxUpload_step(
  jobId: string,
  attempt: number,
  sleepSeconds: number
): Promise<void> {
  "use step";
  jobLog("workflow:wait", "Dropbox upload rate limit wait", { jobId, attempt, sleepSeconds });
  await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.UPLOADING);
}

async function webhookJob_step(
  baseUrl: string,
  body: {
    status: typeof WEBHOOK_JOB_STATUS.READY | typeof WEBHOOK_JOB_STATUS.ERROR;
    jobId: string;
    operationName?: string;
    videoUri?: string;
    error?: string;
  }
): Promise<WebhookStepResult> {
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

  if (body.status === WEBHOOK_JOB_STATUS.READY) {
    let payload: {
      jobCompleted?: boolean;
      retryable?: boolean;
      retryAfterSeconds?: number;
      skipped?: boolean;
      reason?: string;
    } = {};
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      throw new Error("webhook/job returned invalid JSON");
    }
    if (payload.jobCompleted) {
      jobLog("workflow:webhook", "step succeeded — job completed", {
        jobId: body.jobId,
        elapsedMs,
      });
      return { jobCompleted: true };
    }
    if (payload.retryable && payload.retryAfterSeconds) {
      jobLog("workflow:webhook", "Dropbox rate limited — workflow will retry upload", {
        jobId: body.jobId,
        retryAfterSeconds: payload.retryAfterSeconds,
        elapsedMs,
      });
      return {
        jobCompleted: false,
        retryable: true,
        retryAfterSeconds: payload.retryAfterSeconds,
      };
    }
    jobLogError("workflow:webhook", "ready callback did not complete job", {
      jobId: body.jobId,
      skipped: payload.skipped ?? false,
      reason: payload.reason ?? null,
      elapsedMs,
    });
    throw new Error(
      `webhook/job did not complete job${payload.reason ? `: ${payload.reason}` : ""}`
    );
  }

  jobLog("workflow:webhook", "step succeeded", {
    jobId: body.jobId,
    status: body.status,
    elapsedMs,
  });
  return { jobCompleted: false };
}

export async function jobWorkflow(jobId: string, callbackBaseUrl: string): Promise<void> {
  "use workflow";

  const workflowStartedAt = Date.now();
  jobLog("workflow", "run started", { jobId, callbackBaseUrl });

  await workflowPhase_step(jobId, JOB_WORKFLOW_PHASE.STARTING);

  let operationName: string;
  let processAttempt = 0;
  let runwayCreditsWaitAttempts = 0;

  main: while (true) {
    for (;;) {
      processAttempt += 1;
      const stepResult = await processJob_step(jobId, processAttempt);
      if (stepResult.ok) {
        operationName = stepResult.operationName;
        await workflowPhase_step(jobId, JOB_WORKFLOW_PHASE.GENERATING);
        jobLog("workflow", "process phase complete", {
          jobId,
          operationName,
          processAttempts: processAttempt,
          runwayCreditsWaitAttempts,
        });
        break;
      }
      if (stepResult.retryable) {
        if (stepResult.retryReason === "runway_insufficient_credits") {
          runwayCreditsWaitAttempts += 1;
          if (runwayCreditsWaitAttempts >= RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY.maxAttempts) {
            jobLogError("workflow", "Runway credits retries exhausted", {
              jobId,
              attempts: runwayCreditsWaitAttempts,
              maxAttempts: RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY.maxAttempts,
            });
            await failRunwayInsufficientCredits_step(jobId);
            return;
          }
          await workflowWait_runwayCredits_step(
            jobId,
            runwayCreditsWaitAttempts,
            stepResult.retryAfterSeconds
          );
        } else {
          await workflowWait_rateLimit_step(
            jobId,
            processAttempt,
            stepResult.retryAfterSeconds
          );
        }
        jobLog("workflow", "sleeping before process retry", {
          jobId,
          processAttempt,
          retryReason: stepResult.retryReason,
          sleepSeconds: stepResult.retryAfterSeconds,
          runwayCreditsWaitAttempts,
        });
        await sleep(`${stepResult.retryAfterSeconds} seconds`);
        continue;
      }
      jobLogError("workflow", "run failed at process phase", {
        jobId,
        error: stepResult.error,
        processAttempts: processAttempt,
        elapsedMs: Date.now() - workflowStartedAt,
      });
      await webhookJob_step(callbackBaseUrl, {
        status: WEBHOOK_JOB_STATUS.ERROR,
        jobId,
        error: stepResult.error,
      });
      return;
    }

    let pollAttempt = 0;
    for (;;) {
      pollAttempt += 1;
      const status = await pollRunwayTask_step(callbackBaseUrl, jobId, operationName, pollAttempt);

      if (status.done && status.videoUri) {
        jobLog("workflow", "poll phase complete — video ready", {
          jobId,
          operationName,
          pollAttempts: pollAttempt,
          elapsedMs: Date.now() - workflowStartedAt,
        });
        const videoUri = status.videoUri;
        let uploadAttempt = 0;
        for (;;) {
          uploadAttempt += 1;
          const webhookResult = await webhookJob_step(callbackBaseUrl, {
            status: WEBHOOK_JOB_STATUS.READY,
            jobId,
            operationName,
            videoUri,
          });
          if (webhookResult.jobCompleted) break;
          if (webhookResult.retryable && webhookResult.retryAfterSeconds) {
            if (uploadAttempt >= DROPBOX_UPLOAD_WORKFLOW_RETRY.maxAttempts) {
              jobLogError("workflow", "Dropbox upload retries exhausted", {
                jobId,
                attempts: uploadAttempt,
              });
              await webhookJob_step(callbackBaseUrl, {
                status: WEBHOOK_JOB_STATUS.ERROR,
                jobId,
                operationName,
                error: "Dropbox upload rate limit retries exhausted",
              });
              return;
            }
            await workflowWait_dropboxUpload_step(
              jobId,
              uploadAttempt,
              webhookResult.retryAfterSeconds
            );
            jobLog("workflow", "sleeping before Dropbox upload retry", {
              jobId,
              uploadAttempt,
              sleepSeconds: webhookResult.retryAfterSeconds,
            });
            await sleep(`${webhookResult.retryAfterSeconds} seconds`);
            continue;
          }
          throw new Error("webhook/job ready callback failed unexpectedly");
        }
        jobLog("workflow", "run finished successfully", {
          jobId,
          operationName,
          totalElapsedMs: Date.now() - workflowStartedAt,
          processAttempts: processAttempt,
          pollAttempts: pollAttempt,
        });
        return;
      }
      if (status.done && !status.videoUri && !status.error) {
        jobLogError("workflow", "Runway task done without video or error", {
          jobId,
          operationName,
          pollAttempt,
        });
        await webhookJob_step(callbackBaseUrl, {
          status: WEBHOOK_JOB_STATUS.ERROR,
          jobId,
          operationName,
          error: "Runway task finished without output",
        });
        return;
      }
      if (status.done && status.error) {
        if (isRunwayInsufficientCreditsError(status.error)) {
          runwayCreditsWaitAttempts += 1;
          if (runwayCreditsWaitAttempts >= RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY.maxAttempts) {
            jobLogError("workflow", "Runway credits retries exhausted (poll)", {
              jobId,
              attempts: runwayCreditsWaitAttempts,
            });
            await failRunwayInsufficientCredits_step(jobId);
            return;
          }
          jobLog("workflow", "Runway credits error on poll — reset and retry process", {
            jobId,
            error: status.error,
            runwayCreditsWaitAttempts,
          });
          await resetRunwayCreditsRetry_step(jobId);
          await workflowWait_runwayCredits_step(
            jobId,
            runwayCreditsWaitAttempts,
            RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY.intervalSeconds
          );
          await sleep(`${RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY.intervalSeconds} seconds`);
          continue main;
        }
        jobLogError("workflow", "poll phase failed", {
          jobId,
          operationName,
          error: status.error,
          pollAttempts: pollAttempt,
          elapsedMs: Date.now() - workflowStartedAt,
        });
        await webhookJob_step(callbackBaseUrl, {
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

      await workflowWait_poll_step(jobId, operationName, pollAttempt);
      jobLog("workflow", "sleeping before next poll", {
        jobId,
        operationName,
        pollAttempt,
        sleep: "5 seconds",
      });
      await sleep("5 seconds");
    }
  }
}
