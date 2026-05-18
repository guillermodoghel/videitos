/**
 * Vercel Workflow: one durable run per job.
 * Replaces GCP Cloud Tasks + AWS Step Function: process job, poll until done, then webhook.
 * Rate limiting: we retry with sleep in the workflow (no step retry limit); fatal errors call webhook and exit.
 */

import { sleep } from "workflow";
import {
  markJobFailedRunwayInsufficientCredits,
  resetJobForRunwayCreditsRetry,
} from "@/lib/process-job";
import { jobLog, jobLogError } from "@/lib/job-log";
import { workflowStepLog } from "@/lib/workflow-step-log";
import type { WorkflowProcessJobResponse } from "@/lib/workflow-process-job-response";
import { isRunwayInsufficientCreditsError } from "@/lib/runway-errors";
import { WEBHOOK_JOB_STATUS } from "@/lib/constants/webhook-job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import { isJobCanceled } from "@/lib/is-job-canceled";
import { JOB_WORKFLOW_PHASE } from "@/lib/constants/job-workflow-phase";
import { setJobWorkflowPhase } from "@/lib/set-job-workflow-phase";
import { prisma } from "@/lib/prisma";
import { JOB_STATUS } from "@/lib/constants/job-status";
import {
  RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY,
  DROPBOX_UPLOAD_WORKFLOW_RETRY,
  RUNWAY_POLL_WORKFLOW,
  runwayPollSleepSeconds,
} from "@/lib/constants/job-retry";

export type ProcessStepResult = WorkflowProcessJobResponse;

async function workflowPhase_step(
  jobId: string,
  phase: (typeof JOB_WORKFLOW_PHASE)[keyof typeof JOB_WORKFLOW_PHASE]
): Promise<void> {
  "use step";
  workflowStepLog("set_phase", "updating dashboard phase", { jobId, phase });
  await setJobWorkflowPhase(jobId, phase);
  workflowStepLog("set_phase", "phase updated", { jobId, phase });
}

async function processJob_step(
  baseUrl: string,
  jobId: string,
  attempt: number
): Promise<ProcessStepResult> {
  "use step";

  const secret = process.env.JOB_PROCESS_SECRET;
  if (!secret) {
    throw new Error("JOB_PROCESS_SECRET is not configured");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/jobs/workflow/process`;
  jobLog("workflow:process", "step started", { jobId, attempt, url });
  const startedAt = Date.now();

  let res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify({ jobId, attempt }),
  });
  if (!res.ok) {
    jobLog("workflow:process", "HTTP error — retrying once", {
      jobId,
      attempt,
      status: res.status,
    });
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({ jobId, attempt }),
    });
  }

  const elapsedMs = Date.now() - startedAt;

  if (!res.ok) {
    jobLogError("workflow:process", "HTTP error", {
      jobId,
      attempt,
      status: res.status,
      elapsedMs,
    });
    throw new Error(`workflow/process failed: ${res.status}`);
  }

  const result = (await res.json()) as ProcessStepResult;

  if (result.ok) {
    jobLog("workflow:process", "step succeeded", {
      jobId,
      attempt,
      operationName: result.operationName,
      elapsedMs,
    });
    return result;
  }
  if (result.retryable) {
    jobLog("workflow:process", "step retryable", {
      jobId,
      attempt,
      retryReason: result.retryReason,
      retryAfterSeconds: result.retryAfterSeconds,
      elapsedMs,
    });
    return result;
  }
  jobLogError("workflow:process", "step failed (fatal)", {
    jobId,
    attempt,
    error: result.error,
    elapsedMs,
  });
  return result;
}

async function workflowWait_rateLimit_step(
  jobId: string,
  attempt: number,
  sleepSeconds: number
): Promise<void> {
  "use step";
  workflowStepLog("wait_rate_limit", "entering rate-limit wait", {
    jobId,
    attempt,
    sleepSeconds,
    nextPhase: JOB_WORKFLOW_PHASE.WAITING_RATE_LIMIT,
  });
  await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.WAITING_RATE_LIMIT);
  workflowStepLog("wait_rate_limit", "ready to sleep", { jobId, attempt, sleepSeconds });
}

async function workflowWait_runwayCredits_step(
  jobId: string,
  attempt: number,
  sleepSeconds: number
): Promise<void> {
  "use step";
  workflowStepLog("wait_runway_credits", "entering Runway credits wait", {
    jobId,
    attempt,
    sleepSeconds,
    nextPhase: JOB_WORKFLOW_PHASE.WAITING_RUNWAY_CREDITS,
  });
  await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.WAITING_RUNWAY_CREDITS);
  workflowStepLog("wait_runway_credits", "ready to sleep", { jobId, attempt, sleepSeconds });
}

async function workflowWait_poll_step(
  jobId: string,
  operationName: string,
  pollAttempt: number
): Promise<void> {
  "use step";
  workflowStepLog("wait_poll", "between Runway polls", {
    jobId,
    operationName,
    pollAttempt,
    nextPhase: JOB_WORKFLOW_PHASE.POLLING,
  });
  await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.POLLING);
}

async function failRunwayInsufficientCredits_step(jobId: string): Promise<void> {
  "use step";
  workflowStepLog("fail_runway_credits", "marking job failed — Runway credits exhausted", {
    jobId,
  });
  await markJobFailedRunwayInsufficientCredits(jobId);
  workflowStepLog("fail_runway_credits", "job marked failed", { jobId });
}

async function resetRunwayCreditsRetry_step(jobId: string): Promise<void> {
  "use step";
  workflowStepLog("reset_runway_credits", "resetting job to retry after Runway credits error", {
    jobId,
  });
  await resetJobForRunwayCreditsRetry(jobId);
  workflowStepLog("reset_runway_credits", "job reset — will re-enter process phase", { jobId });
}

async function isJobCompleted_step(jobId: string): Promise<boolean> {
  "use step";
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  const completed = job?.status === JOB_STATUS.COMPLETED;
  workflowStepLog("check_completed", completed ? "job already completed" : "job not completed yet", {
    jobId,
    status: job?.status ?? null,
    completed,
  });
  return completed;
}

async function isJobCanceled_step(jobId: string): Promise<boolean> {
  "use step";
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true, errorMessage: true },
  });
  const canceled = isJobCanceled(job?.errorMessage);
  workflowStepLog("check_canceled", canceled ? "job is canceled" : "job not canceled", {
    jobId,
    status: job?.status ?? null,
    canceled,
  });
  return canceled;
}

async function pollRunwayTask_step(
  baseUrl: string,
  jobId: string,
  operationName: string,
  attempt: number
): Promise<{
  done: boolean;
  videoUri?: string;
  error?: string;
  runwayStatus?: string;
  progress?: number;
}> {
  "use step";

  const url = `${baseUrl.replace(/\/$/, "")}/api/job-status`;
  jobLog("workflow:poll", "step started", { jobId, operationName, attempt, url });
  const startedAt = Date.now();

  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, operationName, pollAttempt: attempt }),
  });
  if (!res.ok) {
    jobLog("workflow:poll", "job-status HTTP error — retrying once", {
      jobId,
      operationName,
      attempt,
      status: res.status,
    });
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, operationName, pollAttempt: attempt }),
    });
  }
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

  const status = (await res.json()) as {
    done: boolean;
    videoUri?: string;
    error?: string;
    runwayStatus?: string;
    progress?: number;
  };
  const nextAction =
    status.done && status.videoUri
      ? "upload"
      : status.done && status.error
        ? "handle_error"
        : status.done
          ? "handle_missing_output"
          : "sleep_and_poll_again";
  jobLog("workflow:poll", "step result", {
    jobId,
    operationName,
    attempt,
    runwayStatus: status.runwayStatus ?? null,
    progress: status.progress ?? null,
    done: status.done,
    hasVideoUri: !!status.videoUri,
    error: status.error ?? null,
    nextAction,
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
  workflowStepLog("wait_dropbox_upload", "entering Dropbox rate-limit wait", {
    jobId,
    attempt,
    sleepSeconds,
    nextPhase: JOB_WORKFLOW_PHASE.WAITING_DROPBOX_RATE_LIMIT,
  });
  await setJobWorkflowPhase(jobId, JOB_WORKFLOW_PHASE.WAITING_DROPBOX_RATE_LIMIT);
  workflowStepLog("wait_dropbox_upload", "ready to sleep", { jobId, attempt, sleepSeconds });
}

async function webhookJob_step(
  baseUrl: string,
  body: {
    status: typeof WEBHOOK_JOB_STATUS.READY | typeof WEBHOOK_JOB_STATUS.ERROR;
    jobId: string;
    operationName?: string;
    videoUri?: string;
    error?: string;
    uploadAttempt?: number;
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
    uploadAttempt: body.uploadAttempt ?? null,
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

  async function stopIfCanceled(phase: string): Promise<boolean> {
    if (await isJobCanceled_step(jobId)) {
      jobLog("workflow", "run stopped — job canceled", {
        jobId,
        checkpoint: phase,
        elapsedMs: Date.now() - workflowStartedAt,
      });
      return true;
    }
    return false;
  }

  jobLog("workflow", "entering process phase loop", { jobId });
  await workflowPhase_step(jobId, JOB_WORKFLOW_PHASE.STARTING);
  if (await stopIfCanceled("starting")) return;

  let operationName: string;
  let processAttempt = 0;
  let runwayCreditsWaitAttempts = 0;

  main: while (true) {
    if (await stopIfCanceled("main")) return;

    for (;;) {
      if (await stopIfCanceled("process")) return;

      processAttempt += 1;
      const stepResult = await processJob_step(callbackBaseUrl, jobId, processAttempt);
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
        jobLog("workflow", "sleep finished — resuming process", {
          jobId,
          reason: stepResult.retryReason,
          sleptSeconds: stepResult.retryAfterSeconds,
          processAttempt,
        });
        if (await stopIfCanceled("process_retry_sleep")) return;
        continue;
      }
      if (stepResult.error === JOB_ERROR.CANCELED || (await stopIfCanceled("process_fatal"))) {
        return;
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

    jobLog("workflow", "entering poll phase loop", {
      jobId,
      operationName,
      maxPollAttempts: RUNWAY_POLL_WORKFLOW.maxAttempts,
    });
    let pollAttempt = 0;
    for (;;) {
      if (await stopIfCanceled("poll")) return;

      pollAttempt += 1;
      jobLog("workflow", "poll iteration", {
        jobId,
        operationName,
        pollAttempt,
        maxAttempts: RUNWAY_POLL_WORKFLOW.maxAttempts,
      });

      if (pollAttempt > RUNWAY_POLL_WORKFLOW.maxAttempts) {
        jobLogError("workflow", "poll timeout waiting for Runway", {
          jobId,
          operationName,
          pollAttempts: pollAttempt,
          maxAttempts: RUNWAY_POLL_WORKFLOW.maxAttempts,
          elapsedMs: Date.now() - workflowStartedAt,
        });
        await webhookJob_step(callbackBaseUrl, {
          status: WEBHOOK_JOB_STATUS.ERROR,
          jobId,
          operationName,
          error: "Timed out waiting for Runway generation (60 minutes)",
        });
        return;
      }

      if (await isJobCompleted_step(jobId)) {
        jobLog("workflow", "job already completed — stop polling", {
          jobId,
          operationName,
          pollAttempts: pollAttempt,
        });
        return;
      }

      const status = await pollRunwayTask_step(callbackBaseUrl, jobId, operationName, pollAttempt);

      if (status.done && status.videoUri) {
        jobLog("workflow", "poll phase complete — video ready", {
          jobId,
          operationName,
          pollAttempts: pollAttempt,
          elapsedMs: Date.now() - workflowStartedAt,
        });
        const videoUri = status.videoUri;
        jobLog("workflow", "entering upload phase loop", { jobId, operationName });
        let uploadAttempt = 0;
        for (;;) {
          if (await stopIfCanceled("dropbox_upload")) return;

          uploadAttempt += 1;
          jobLog("workflow", "upload iteration", {
            jobId,
            operationName,
            uploadAttempt,
            maxAttempts: DROPBOX_UPLOAD_WORKFLOW_RETRY.maxAttempts,
          });
          const webhookResult = await webhookJob_step(callbackBaseUrl, {
            status: WEBHOOK_JOB_STATUS.READY,
            jobId,
            operationName,
            videoUri,
            uploadAttempt,
          });
          if (webhookResult.jobCompleted) break;
          if (
            webhookResult.jobCompleted === false &&
            "retryable" in webhookResult &&
            webhookResult.retryable
          ) {
            const retryAfterSeconds = Math.min(
              webhookResult.retryAfterSeconds,
              DROPBOX_UPLOAD_WORKFLOW_RETRY.maxSleepSeconds
            );
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
            await workflowWait_dropboxUpload_step(jobId, uploadAttempt, retryAfterSeconds);
            jobLog("workflow", "sleeping before Dropbox upload retry", {
              jobId,
              uploadAttempt,
              sleepSeconds: retryAfterSeconds,
            });
            await sleep(`${retryAfterSeconds} seconds`);
            jobLog("workflow", "sleep finished — resuming Dropbox upload", {
              jobId,
              uploadAttempt,
              sleptSeconds: retryAfterSeconds,
            });
            if (await stopIfCanceled("dropbox_upload_retry_sleep")) return;
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
          jobLog("workflow", "sleep finished — restarting process after Runway credits", {
            jobId,
            runwayCreditsWaitAttempts,
            sleptSeconds: RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY.intervalSeconds,
          });
          if (await stopIfCanceled("runway_credits_poll_sleep")) return;
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
      const sleepSeconds = runwayPollSleepSeconds();
      jobLog("workflow", "sleeping before next poll", {
        jobId,
        operationName,
        pollAttempt,
        runwayStatus: status.runwayStatus ?? null,
        progress: status.progress ?? null,
        sleepSeconds,
      });
      await sleep(`${sleepSeconds} seconds`);
      jobLog("workflow", "sleep finished — next poll", {
        jobId,
        operationName,
        pollAttempt,
        sleptSeconds: sleepSeconds,
        lastRunwayStatus: status.runwayStatus ?? null,
        lastProgress: status.progress ?? null,
      });
      if (await stopIfCanceled("poll_sleep")) return;
    }
  }
}
