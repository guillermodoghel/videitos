/** Normalize Runway task progress to 0–1 (API may send 0–1 or 0–100). */
export function normalizeRunwayProgress(
  progress: number | null | undefined
): number | null {
  if (progress == null || Number.isNaN(progress)) return null;
  if (progress > 1 && progress <= 100) return progress / 100;
  return Math.min(1, Math.max(0, progress));
}

/** Display label e.g. "42%" from raw or normalized progress. */
export function formatRunwayProgressPercent(
  progress: number | null | undefined
): string | null {
  const normalized = normalizeRunwayProgress(progress);
  if (normalized == null) return null;
  return `${Math.round(normalized * 100)}%`;
}
