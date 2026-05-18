"use client";

import { JOB_STATUS } from "@/lib/constants/job-status";
import { isActiveJobStatus } from "@/lib/job-live-update";
import {
  runwayProgressFraction,
  formatRunwayProgressPercent,
  formatRunwayTaskProgressDetail,
} from "@/lib/runway-progress-display";
import { JobWorkflowProgressGraph } from "./JobWorkflowProgressGraph";

function RunwayProgressBar({
  fraction,
  indeterminate,
}: {
  fraction: number | null;
  indeterminate?: boolean;
}) {
  return (
    <div
      className="h-1.5 w-full min-w-[8rem] max-w-xs overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction != null ? Math.round(fraction * 100) : undefined}
      aria-label="Runway generation progress"
    >
      {indeterminate ? (
        <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-500 dark:bg-sky-400" />
      ) : (
        <div
          className="h-full rounded-full bg-sky-500 transition-[width] duration-500 dark:bg-sky-400"
          style={{ width: `${Math.round((fraction ?? 0) * 100)}%` }}
        />
      )}
    </div>
  );
}

/** Progress bar + labels shown in the jobs table for active jobs. */
export function JobActiveStatusDisplay({
  status,
  workflowPhase,
  errorMessage,
  runwayProgress,
  runwayPollStatus,
  compactGraph = false,
}: {
  status: string;
  workflowPhase: string | null;
  errorMessage: string | null;
  runwayProgress: number | null;
  runwayPollStatus: string | null;
  /** When true, render the full pipeline graph (expanded row). */
  compactGraph?: boolean;
}) {
  if (compactGraph) {
    return (
      <JobWorkflowProgressGraph
        status={status}
        workflowPhase={workflowPhase}
        errorMessage={errorMessage}
        runwayProgress={runwayProgress}
        runwayPollStatus={runwayPollStatus}
      />
    );
  }

  if (!isActiveJobStatus(status)) return null;

  const fraction = runwayProgressFraction(runwayProgress, runwayPollStatus);
  const pctLabel = formatRunwayProgressPercent(runwayProgress, runwayPollStatus ?? null);
  const runwayDetail = formatRunwayTaskProgressDetail(runwayPollStatus, runwayProgress);
  const showIndeterminate =
    fraction == null &&
    (status === JOB_STATUS.PROCESSING || status === JOB_STATUS.SENT_TO_VEO) &&
    (workflowPhase === "generating" ||
      workflowPhase === "polling" ||
      workflowPhase === "submitting");

  return (
    <div className="mt-2 space-y-1.5">
      {(pctLabel || runwayDetail || showIndeterminate) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
          {pctLabel && (
            <span className="font-semibold tabular-nums text-sky-700 dark:text-sky-300">
              {pctLabel}
            </span>
          )}
          {runwayDetail && !pctLabel && <span>{runwayDetail}</span>}
          {showIndeterminate && !pctLabel && !runwayDetail && (
            <span>Waiting for Runway…</span>
          )}
        </div>
      )}
      {(fraction != null || showIndeterminate) && (
        <RunwayProgressBar fraction={fraction} indeterminate={showIndeterminate} />
      )}
    </div>
  );
}
