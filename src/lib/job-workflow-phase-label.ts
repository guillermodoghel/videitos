import { JOB_STATUS } from "@/lib/constants/job-status";
import {
  JOB_WORKFLOW_PHASE,
  JOB_WORKFLOW_PHASE_LABEL,
  type JobWorkflowPhase,
} from "@/lib/constants/job-workflow-phase";

const PHASES_WITH_RUNWAY_PROGRESS = new Set<string>([
  JOB_WORKFLOW_PHASE.GENERATING,
  JOB_WORKFLOW_PHASE.POLLING,
]);

const ACTIVE_STATUSES = new Set<string>([
  JOB_STATUS.QUEUED,
  JOB_STATUS.PROCESSING,
  JOB_STATUS.SENT_TO_VEO,
]);

function formatRunwayProgressPercent(progress: number | null | undefined): string | null {
  if (progress == null || Number.isNaN(progress)) return null;
  const clamped = Math.min(1, Math.max(0, progress));
  return `${Math.round(clamped * 100)}%`;
}

/** Human-readable status when workflowPhase is set on an active job. */
export function getJobWorkflowPhaseLabel(
  status: string,
  workflowPhase: string | null | undefined,
  runwayProgress?: number | null
): string | null {
  if (!workflowPhase || !ACTIVE_STATUSES.has(status)) return null;
  if (workflowPhase in JOB_WORKFLOW_PHASE_LABEL) {
    const base = JOB_WORKFLOW_PHASE_LABEL[workflowPhase as JobWorkflowPhase];
    if (PHASES_WITH_RUNWAY_PROGRESS.has(workflowPhase)) {
      const pct = formatRunwayProgressPercent(runwayProgress);
      if (pct) return `${base} (${pct})`;
    }
    return base;
  }
  return null;
}
