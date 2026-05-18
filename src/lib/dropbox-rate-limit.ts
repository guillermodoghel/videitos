/** Max time to block inside one serverless/workflow step waiting on Dropbox 429. */
export const DROPBOX_MAX_INLINE_BACKOFF_MS = 90_000;

export class DropboxRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Dropbox rate limited — retry after ${retryAfterSeconds}s`);
    this.name = "DropboxRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isDropboxRateLimitError(err: unknown): err is DropboxRateLimitError {
  return err instanceof DropboxRateLimitError;
}
