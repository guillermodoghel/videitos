/**
 * Runway task statuses from GET /v1/tasks/{id}.
 * @see https://docs.dev.runwayml.com/api-details/sdks/
 * @see https://github.com/runwayml/sdk-node/blob/main/src/resources/tasks.ts
 */
export const RUNWAY_TASK_STATUS = {
  PENDING: "PENDING",
  THROTTLED: "THROTTLED",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELED",
} as const;

export type RunwayTaskStatusCode =
  (typeof RUNWAY_TASK_STATUS)[keyof typeof RUNWAY_TASK_STATUS];

/** Active (in-flight) Runway task statuses. */
export const RUNWAY_ACTIVE_TASK_STATUSES = new Set<string>([
  RUNWAY_TASK_STATUS.PENDING,
  RUNWAY_TASK_STATUS.THROTTLED,
  RUNWAY_TASK_STATUS.RUNNING,
]);
