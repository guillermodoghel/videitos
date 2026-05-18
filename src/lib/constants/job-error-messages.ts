/**
 * Known job errorMessage values used for matching (e.g. resume after credits).
 * process-job sets display message; webhook/job may overwrite with error code string.
 */
export const JOB_ERROR = {
  /** Videitos platform credit balance (not Runway). */
  INSUFFICIENT_CREDITS: "Insufficient credits",
  INSUFFICIENT_CREDITS_CODE: "insufficient_credits",
  /** Runway API org out of credits (402 / billing). */
  RUNWAY_INSUFFICIENT_CREDITS: "Runway account has insufficient credits",
  RUNWAY_INSUFFICIENT_CREDITS_CODE: "runway_insufficient_credits",
  NO_RUNWAY_API_KEY: "No Runway API key. Add your key in Settings or ask an admin to add platform key.",
  DROPBOX_NOT_CONNECTED: "Dropbox not connected",
  DROPBOX_UPLOAD_FAILED: "Failed to upload to Dropbox",
  DROPBOX_DESTINATION_NOT_FOUND: "Dropbox destination folder not found",
  DROPBOX_OUT_OF_SPACE: "Dropbox is out of storage space",
  CANCELED: "Canceled",
  UNSUPPORTED_MODEL: "Unsupported model (only Runway is supported)",
} as const;

/** Messages that mean "failed due to insufficient credits" (for resume logic). */
export const INSUFFICIENT_CREDITS_ERROR_MESSAGES: readonly string[] = [
  JOB_ERROR.INSUFFICIENT_CREDITS,
  JOB_ERROR.INSUFFICIENT_CREDITS_CODE,
];

const DROPBOX_ERROR_DETAIL_MAX_LEN = 2000;

/** Persist raw Dropbox API / HTTP failure text (trimmed). */
export function truncateDropboxUploadErrorDetail(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length <= DROPBOX_ERROR_DETAIL_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, DROPBOX_ERROR_DETAIL_MAX_LEN - 1)}…`;
}

/** Short job errorMessage for the UI; full API reason goes in dropboxUploadErrorDetail. */
export function formatDropboxUploadJobError(dropboxReason: string): string {
  const lower = dropboxReason.toLowerCase();
  if (lower.includes("insufficient_space") || lower.includes("over_quota")) {
    return JOB_ERROR.DROPBOX_OUT_OF_SPACE;
  }
  if (lower.includes("path/not_found") || lower.includes("not_found/")) {
    return JOB_ERROR.DROPBOX_DESTINATION_NOT_FOUND;
  }
  if (lower.includes("payload_too_large")) {
    return "Video is too large for Dropbox";
  }
  return JOB_ERROR.DROPBOX_UPLOAD_FAILED;
}
