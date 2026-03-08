/**
 * Job webhook callback payload status (ready | error).
 */
export const WEBHOOK_JOB_STATUS = {
  READY: "ready",
  ERROR: "error",
} as const;

export type WebhookJobStatus = (typeof WEBHOOK_JOB_STATUS)[keyof typeof WEBHOOK_JOB_STATUS];
