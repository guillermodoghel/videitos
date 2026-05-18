import { JOB_STATUS } from "@/lib/constants/job-status";

/** Fields that change while a job is running (safe to poll without reloading the full list). */
export type JobLiveUpdate = {
  id: string;
  status: string;
  workflowPhase: string | null;
  runwayProgress: number | null;
  runwayPollStatus: string | null;
  errorMessage: string | null;
  dropboxUploadErrorDetail: string | null;
  providerOperationId: string | null;
  outputDropboxPath: string | null;
  canRetryDropboxUpload: boolean;
  apiCost: number | null;
  creditCost: number | null;
  completedAt: string | null;
};

const LIVE_KEYS: (keyof JobLiveUpdate)[] = [
  "id",
  "status",
  "workflowPhase",
  "runwayProgress",
  "runwayPollStatus",
  "errorMessage",
  "dropboxUploadErrorDetail",
  "providerOperationId",
  "outputDropboxPath",
  "canRetryDropboxUpload",
  "apiCost",
  "creditCost",
  "completedAt",
];

export const ACTIVE_JOB_STATUSES = new Set<string>([
  JOB_STATUS.QUEUED,
  JOB_STATUS.PROCESSING,
  JOB_STATUS.SENT_TO_VEO,
]);

export function isActiveJobStatus(status: string): boolean {
  return ACTIVE_JOB_STATUSES.has(status);
}

function liveSnapshot(row: JobLiveUpdate): string {
  return LIVE_KEYS.map((k) => `${k}:${row[k] ?? ""}`).join("|");
}

/** Returns merged rows, or null if nothing changed (skip React update). */
export function mergeJobLiveUpdates<T extends JobLiveUpdate>(
  rows: T[],
  updates: JobLiveUpdate[]
): T[] | null {
  if (updates.length === 0) return null;
  const byId = new Map(updates.map((u) => [u.id, u]));
  let changed = false;
  const next = rows.map((row) => {
    const patch = byId.get(row.id);
    if (!patch) return row;
    if (liveSnapshot(row) === liveSnapshot(patch)) return row;
    changed = true;
    return { ...row, ...patch };
  });
  return changed ? next : null;
}
