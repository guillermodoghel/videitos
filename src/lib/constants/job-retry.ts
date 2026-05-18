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
  maxAttempts: 24,
  /** Cap sleep (Dropbox often sends 300s; we retry sooner using S3 cache). */
  maxSleepSeconds: 90,
} as const;

/**
 * Poll Runway task status until done or timeout.
 * Runway recommends ≥5s between polls; official SDK uses ~6s + jitter.
 * @see https://docs.dev.runwayml.com/api-details/sdks/
 */
export const RUNWAY_POLL_WORKFLOW = {
  intervalSeconds: 5,
  /** Random jitter (seconds) added to each poll sleep, matching SDK behavior. */
  jitterSeconds: 1.5,
  /** 720 × ~5.75s ≈ 60 minutes max wait for generation. */
  maxAttempts: 720,
} as const;

/** Poll interval with jitter (min 5s per Runway API guidance). */
export function runwayPollSleepSeconds(): number {
  const { intervalSeconds, jitterSeconds } = RUNWAY_POLL_WORKFLOW;
  const jitter = (Math.random() * 2 - 1) * jitterSeconds;
  return Math.max(5, Math.round((intervalSeconds + jitter) * 10) / 10);
}
