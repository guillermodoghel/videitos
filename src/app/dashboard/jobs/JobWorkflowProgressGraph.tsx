"use client";

import {
  getJobWorkflowGraphSteps,
  type WorkflowGraphStep,
  type WorkflowGraphStepState,
} from "@/lib/job-workflow-progress";

function StepIcon({ state, size = "md" }: { state: WorkflowGraphStepState; size?: "md" | "sm" }) {
  const dim = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const iconDim = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const dotDim = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";

  if (state === "completed") {
    return (
      <span
        className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white`}
      >
        <svg className={iconDim} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span
        className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-red-500 text-white`}
      >
        <svg className={iconDim} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (state === "waiting") {
    return (
      <span
        className={`flex ${dim} shrink-0 items-center justify-center rounded-full border-2 border-amber-400 bg-amber-50 text-amber-600 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-300`}
      >
        <svg className={iconDim} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span
        className={`relative flex ${dim} shrink-0 items-center justify-center rounded-full border-2 border-sky-500 bg-sky-50 dark:border-sky-400 dark:bg-sky-950/50`}
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-30" />
        <span className={`relative ${dotDim} rounded-full bg-sky-500 dark:bg-sky-400`} />
      </span>
    );
  }
  return (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full border-2 border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-800`}
    >
      <span className={`${dotDim} rounded-full bg-zinc-300 dark:bg-zinc-600`} />
    </span>
  );
}

function connectorClass(state: WorkflowGraphStepState, orientation: "horizontal" | "vertical"): string {
  const color =
    state === "completed"
      ? "bg-emerald-400 dark:bg-emerald-600"
      : state === "failed"
        ? "bg-red-300 dark:bg-red-800"
        : state === "active" || state === "waiting"
          ? "bg-sky-300 dark:bg-sky-700"
          : "bg-zinc-200 dark:bg-zinc-700";
  return orientation === "horizontal"
    ? `h-0.5 min-w-[0.75rem] flex-1 ${color}`
    : `my-1 w-0.5 min-h-[1.25rem] flex-1 ${color}`;
}

function stepLabelClass(state: WorkflowGraphStepState): string {
  if (state === "active") return "font-semibold text-sky-700 dark:text-sky-300";
  if (state === "waiting") return "font-semibold text-amber-700 dark:text-amber-300";
  if (state === "completed") return "font-medium text-emerald-700 dark:text-emerald-300";
  if (state === "failed") return "font-semibold text-red-700 dark:text-red-300";
  return "text-zinc-500 dark:text-zinc-400";
}

function WorkflowStepRow({
  step,
  isLast,
}: {
  step: WorkflowGraphStep;
  isLast: boolean;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <StepIcon state={step.state} />
        {!isLast && <span className={connectorClass(step.state, "vertical")} aria-hidden />}
      </div>
      <div className={`min-w-0 flex-1 pb-4 ${isLast ? "pb-0" : ""}`}>
        <p className={`text-sm leading-tight ${stepLabelClass(step.state)}`}>{step.label}</p>
        {step.detail && (
          <p className="mt-0.5 text-xs leading-snug text-zinc-500 dark:text-zinc-400">{step.detail}</p>
        )}
      </div>
    </li>
  );
}

function WorkflowStepColumn({
  step,
  isLast,
}: {
  step: WorkflowGraphStep;
  isLast: boolean;
}) {
  return (
    <li className="flex min-w-[4.75rem] max-w-[7.5rem] flex-1 flex-col">
      <div className="flex w-full items-center">
        <StepIcon state={step.state} size="sm" />
        {!isLast && <span className={`mx-1 ${connectorClass(step.state, "horizontal")}`} aria-hidden />}
      </div>
      <div className="mt-2 w-full px-0.5 text-center">
        <p className={`text-[11px] leading-tight ${stepLabelClass(step.state)}`}>{step.label}</p>
        {step.detail && (
          <p className="mt-0.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{step.detail}</p>
        )}
      </div>
    </li>
  );
}

export function jobWorkflowProgressKey(input: {
  status: string;
  workflowPhase: string | null;
  runwayProgress: number | null;
  runwayPollStatus: string | null;
}): string {
  return [
    input.status,
    input.workflowPhase ?? "",
    input.runwayProgress ?? "",
    input.runwayPollStatus ?? "",
  ].join(":");
}

export function JobWorkflowProgressGraph({
  status,
  workflowPhase,
  errorMessage,
  runwayProgress,
  runwayPollStatus,
  layout = "horizontal",
}: {
  status: string;
  workflowPhase: string | null;
  errorMessage: string | null;
  runwayProgress: number | null;
  runwayPollStatus: string | null;
  layout?: "horizontal" | "vertical";
}) {
  const steps = getJobWorkflowGraphSteps({
    status,
    workflowPhase,
    errorMessage,
    runwayProgress,
    runwayPollStatus,
  });

  const activeStep = steps.find((s) => s.state === "active" || s.state === "waiting");

  return (
    <div
      className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-600 dark:bg-zinc-900"
      data-workflow-key={jobWorkflowProgressKey({
        status,
        workflowPhase,
        runwayProgress,
        runwayPollStatus,
      })}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Pipeline
        </h4>
        {activeStep && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Now:{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-200">{activeStep.label}</span>
            {activeStep.detail ? ` — ${activeStep.detail}` : ""}
          </span>
        )}
      </div>
      {layout === "horizontal" ? (
        <ol
          className="m-0 flex w-full min-w-0 list-none gap-0 overflow-x-auto p-0 pb-1"
          aria-label="Job workflow progress"
        >
          {steps.map((step, index) => (
            <WorkflowStepColumn key={step.id} step={step} isLast={index === steps.length - 1} />
          ))}
        </ol>
      ) : (
        <ol className="m-0 w-full max-w-lg list-none p-0" aria-label="Job workflow progress">
          {steps.map((step, index) => (
            <WorkflowStepRow key={step.id} step={step} isLast={index === steps.length - 1} />
          ))}
        </ol>
      )}
    </div>
  );
}
