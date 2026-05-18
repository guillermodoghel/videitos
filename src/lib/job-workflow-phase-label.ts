import { JOB_STATUS } from "@/lib/constants/job-status";
import {
  JOB_WORKFLOW_PHASE_LABEL,
  type JobWorkflowPhase,
} from "@/lib/constants/job-workflow-phase";

const ACTIVE_STATUSES = new Set<string>([
  JOB_STATUS.QUEUED,
  JOB_STATUS.PROCESSING,
  JOB_STATUS.SENT_TO_VEO,
]);

/** Human-readable status when workflowPhase is set on an active job. */
export function getJobWorkflowPhaseLabel(
  status: string,
  workflowPhase: string | null | undefined
): string | null {
  if (!workflowPhase || !ACTIVE_STATUSES.has(status)) return null;
  if (workflowPhase in JOB_WORKFLOW_PHASE_LABEL) {
    return JOB_WORKFLOW_PHASE_LABEL[workflowPhase as JobWorkflowPhase];
  }
  return null;
}
