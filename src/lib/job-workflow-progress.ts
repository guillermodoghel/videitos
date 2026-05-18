import { JOB_STATUS } from "@/lib/constants/job-status";
import { JOB_ERROR } from "@/lib/constants/job-error-messages";
import {
  JOB_WORKFLOW_PHASE,
  JOB_WORKFLOW_PHASE_LABEL,
  type JobWorkflowPhase,
} from "@/lib/constants/job-workflow-phase";
import { appendRunwayProgressToLabel } from "@/lib/runway-progress-display";

export type WorkflowGraphStepState =
  | "pending"
  | "active"
  | "waiting"
  | "completed"
  | "failed";

export type WorkflowGraphStep = {
  id: string;
  label: string;
  state: WorkflowGraphStepState;
  detail?: string;
};

const GRAPH_STEP_DEFS = [
  { id: "queued", label: "Queued" },
  { id: "starting", label: "Starting" },
  { id: "claiming_slot", label: "Claim slot" },
  { id: "preparing", label: "Prepare input" },
  { id: "submitting", label: "Start generation" },
  { id: "generating", label: "Generate video" },
  { id: "uploading", label: "Upload to Dropbox" },
  { id: "complete", label: "Complete" },
] as const;

const PHASE_TO_STEP_INDEX: Record<JobWorkflowPhase, number> = {
  [JOB_WORKFLOW_PHASE.STARTING]: 1,
  [JOB_WORKFLOW_PHASE.CLAIMING_SLOT]: 2,
  [JOB_WORKFLOW_PHASE.WAITING_RATE_LIMIT]: 2,
  [JOB_WORKFLOW_PHASE.PREPARING]: 3,
  [JOB_WORKFLOW_PHASE.WAITING_RUNWAY_CREDITS]: 3,
  [JOB_WORKFLOW_PHASE.SUBMITTING]: 4,
  [JOB_WORKFLOW_PHASE.GENERATING]: 5,
  [JOB_WORKFLOW_PHASE.POLLING]: 5,
  [JOB_WORKFLOW_PHASE.UPLOADING]: 6,
  [JOB_WORKFLOW_PHASE.WAITING_DROPBOX_RATE_LIMIT]: 6,
};

const WAITING_PHASES = new Set<string>([
  JOB_WORKFLOW_PHASE.WAITING_RATE_LIMIT,
  JOB_WORKFLOW_PHASE.WAITING_RUNWAY_CREDITS,
  JOB_WORKFLOW_PHASE.WAITING_DROPBOX_RATE_LIMIT,
]);

const ACTIVE_STATUSES = new Set<string>([
  JOB_STATUS.QUEUED,
  JOB_STATUS.PROCESSING,
  JOB_STATUS.SENT_TO_VEO,
]);

function phaseDetail(
  phase: JobWorkflowPhase,
  runwayProgress: number | null | undefined,
  runwayPollStatus: string | null | undefined
): string | undefined {
  if (phase in JOB_WORKFLOW_PHASE_LABEL) {
    const base = JOB_WORKFLOW_PHASE_LABEL[phase];
    if (
      phase === JOB_WORKFLOW_PHASE.GENERATING ||
      phase === JOB_WORKFLOW_PHASE.POLLING
    ) {
      return appendRunwayProgressToLabel(base, runwayPollStatus, runwayProgress);
    }
    return base;
  }
  return undefined;
}

function buildSteps(
  states: WorkflowGraphStepState[],
  details: (string | undefined)[]
): WorkflowGraphStep[] {
  return GRAPH_STEP_DEFS.map((def, i) => ({
    id: def.id,
    label: def.label,
    state: states[i],
    detail: details[i],
  }));
}

/** Ordered pipeline steps with per-step state for the jobs dashboard graph. */
export function getJobWorkflowGraphSteps(input: {
  status: string;
  workflowPhase: string | null | undefined;
  errorMessage: string | null | undefined;
  runwayProgress?: number | null;
  runwayPollStatus?: string | null;
}): WorkflowGraphStep[] {
  const count = GRAPH_STEP_DEFS.length;
  const pending = (): WorkflowGraphStepState[] => Array(count).fill("pending");
  const completed = (): WorkflowGraphStepState[] => Array(count).fill("completed");

  if (input.status === JOB_STATUS.COMPLETED) {
    return buildSteps(completed(), []);
  }

  const isCanceled =
    input.status === JOB_STATUS.FAILED &&
    input.errorMessage === JOB_ERROR.CANCELED;

  if (input.status === JOB_STATUS.FAILED) {
    const states = pending();
    const details: (string | undefined)[] = Array(count).fill(undefined);
    const phase = input.workflowPhase as JobWorkflowPhase | null | undefined;
    let failedIndex = phase && phase in PHASE_TO_STEP_INDEX ? PHASE_TO_STEP_INDEX[phase] : 1;

    if (!phase) {
      failedIndex = 0;
    }

    for (let i = 0; i < failedIndex; i++) states[i] = "completed";
    states[failedIndex] = "failed";
    details[failedIndex] = isCanceled ? "Canceled" : input.errorMessage ?? "Failed";
    return buildSteps(states, details);
  }

  if (input.status === JOB_STATUS.QUEUED) {
    const states = pending();
    states[0] = "active";
    return buildSteps(states, []);
  }

  if (!ACTIVE_STATUSES.has(input.status)) {
    return buildSteps(pending(), []);
  }

  const phase = input.workflowPhase as JobWorkflowPhase | null | undefined;
  if (!phase || !(phase in PHASE_TO_STEP_INDEX)) {
    const states = pending();
    states[0] = "completed";
    states[1] = "active";
    return buildSteps(states, [undefined, "Processing…"]);
  }

  const activeIndex = PHASE_TO_STEP_INDEX[phase];
  const states = pending();
  const details: (string | undefined)[] = Array(count).fill(undefined);

  for (let i = 0; i < activeIndex; i++) states[i] = "completed";
  states[activeIndex] = WAITING_PHASES.has(phase) ? "waiting" : "active";
  details[activeIndex] = phaseDetail(phase, input.runwayProgress, input.runwayPollStatus);

  return buildSteps(states, details);
}
