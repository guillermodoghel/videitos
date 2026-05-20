/**
 * Workflow phase codes stored on Job.workflowPhase while a job is active.
 * Shown in the dashboard and updated from workflow steps (visible in Vercel Observability).
 */
export const JOB_WORKFLOW_PHASE = {
  STARTING: "starting",
  CLAIMING_SLOT: "claiming_slot",
  PREPARING: "preparing",
  SUBMITTING: "submitting",
  WAITING_RATE_LIMIT: "waiting_rate_limit",
  WAITING_RUNWAY_CREDITS: "waiting_runway_credits",
  WAITING_RUNWAY_HIGH_LOAD: "waiting_runway_high_load",
  GENERATING: "generating",
  POLLING: "polling",
  UPLOADING: "uploading",
  WAITING_DROPBOX_RATE_LIMIT: "waiting_dropbox_rate_limit",
} as const;

export type JobWorkflowPhase =
  (typeof JOB_WORKFLOW_PHASE)[keyof typeof JOB_WORKFLOW_PHASE];

export const JOB_WORKFLOW_PHASE_LABEL: Record<JobWorkflowPhase, string> = {
  [JOB_WORKFLOW_PHASE.STARTING]: "Starting workflow",
  [JOB_WORKFLOW_PHASE.CLAIMING_SLOT]: "Claiming Runway slot",
  [JOB_WORKFLOW_PHASE.PREPARING]: "Preparing input",
  [JOB_WORKFLOW_PHASE.SUBMITTING]: "Starting generation",
  [JOB_WORKFLOW_PHASE.WAITING_RATE_LIMIT]: "Waiting for slot",
  [JOB_WORKFLOW_PHASE.WAITING_RUNWAY_CREDITS]: "Waiting for Runway credits",
  [JOB_WORKFLOW_PHASE.WAITING_RUNWAY_HIGH_LOAD]: "Runway busy — retrying",
  [JOB_WORKFLOW_PHASE.GENERATING]: "Generating video",
  [JOB_WORKFLOW_PHASE.POLLING]: "Checking generation status",
  [JOB_WORKFLOW_PHASE.UPLOADING]: "Uploading to Dropbox",
  [JOB_WORKFLOW_PHASE.WAITING_DROPBOX_RATE_LIMIT]: "Waiting for Dropbox (rate limit)",
};
