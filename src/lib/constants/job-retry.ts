/** Workflow waits when Runway returns out-of-credits (user may top up Runway / autobilling). */
export const RUNWAY_INSUFFICIENT_CREDITS_WORKFLOW_RETRY = {
  intervalSeconds: 30,
  /** 20 × 30s ≈ 10 minutes. */
  maxAttempts: 20,
} as const;

/** Workflow backoff when rate limit slots are full. */
export const RATE_LIMIT_WORKFLOW_RETRY_SECONDS = 5;

/** Workflow retries when Dropbox returns 429 with a long retry-after. */
export const DROPBOX_UPLOAD_WORKFLOW_RETRY = {
  maxAttempts: 12,
} as const;
