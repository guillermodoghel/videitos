/**
 * Job status values (stored in DB and used in APIs).
 * Legacy: SENT_TO_VEO is migrated to PROCESSING in behavior.
 */
export const JOB_STATUS = {
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  /** @deprecated Legacy; treat as processing in UI */
  SENT_TO_VEO: "sent_to_veo",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];
