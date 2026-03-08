/**
 * Known job errorMessage values used for matching (e.g. resume after credits).
 * process-job sets display message; webhook/job may overwrite with error code string.
 */
export const JOB_ERROR = {
  INSUFFICIENT_CREDITS: "Insufficient credits",
  INSUFFICIENT_CREDITS_CODE: "insufficient_credits",
  NO_RUNWAY_API_KEY: "No Runway API key. Add your key in Settings or ask an admin to add platform key.",
  DROPBOX_NOT_CONNECTED: "Dropbox not connected",
  UNSUPPORTED_MODEL: "Unsupported model (only Runway is supported)",
} as const;

/** Messages that mean "failed due to insufficient credits" (for resume logic). */
export const INSUFFICIENT_CREDITS_ERROR_MESSAGES: readonly string[] = [
  JOB_ERROR.INSUFFICIENT_CREDITS,
  JOB_ERROR.INSUFFICIENT_CREDITS_CODE,
];
