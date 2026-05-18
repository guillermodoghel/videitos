import { RUNWAY_TASK_STATUS } from "@/lib/constants/runway-task-status";

/**
 * Runway returns `progress` (0–1) only while status is RUNNING.
 * PENDING / THROTTLED have no progress field.
 * @see https://github.com/runwayml/sdk-node/blob/main/src/resources/tasks.ts
 */
export function normalizeRunwayProgress(
  progress: number | null | undefined,
  runwayStatus?: string | null
): number | null {
  if (runwayStatus && runwayStatus.toUpperCase() !== RUNWAY_TASK_STATUS.RUNNING) {
    return null;
  }
  if (progress == null || Number.isNaN(progress)) return null;
  if (progress > 1 && progress <= 100) return progress / 100;
  return Math.min(1, Math.max(0, progress));
}

/** Display label e.g. "42%" from raw or normalized progress. */
export function formatRunwayProgressPercent(
  progress: number | null | undefined,
  runwayStatus?: string | null
): string | null {
  const normalized = normalizeRunwayProgress(progress, runwayStatus);
  if (normalized == null) return null;
  return `${Math.round(normalized * 100)}%`;
}

/** Human-readable detail for dashboard (poll status + optional %). */
export function formatRunwayTaskProgressDetail(
  runwayStatus: string | null | undefined,
  progress: number | null | undefined
): string | null {
  const status = runwayStatus?.toUpperCase();
  if (!status) return null;

  if (status === RUNWAY_TASK_STATUS.RUNNING) {
    const pct = formatRunwayProgressPercent(progress, status);
    return pct ?? "Running";
  }
  if (status === RUNWAY_TASK_STATUS.THROTTLED) {
    return "Waiting for Runway slot";
  }
  if (status === RUNWAY_TASK_STATUS.PENDING) {
    return "Queued at Runway";
  }
  return status;
}

/** Append Runway poll detail to a workflow phase label when useful. */
export function appendRunwayProgressToLabel(
  baseLabel: string,
  runwayStatus: string | null | undefined,
  progress: number | null | undefined
): string {
  const detail = formatRunwayTaskProgressDetail(runwayStatus, progress);
  if (!detail) return baseLabel;
  return `${baseLabel} (${detail})`;
}
