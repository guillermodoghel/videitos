/** Default retries after the first attempt (5 tries total). */
export const DEFAULT_HTTP_MAX_RETRIES = 4;

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function backoffMs(
  attempt: number,
  retryAfterHeader: string | null,
  baseMs = 500
): number {
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSeconds)) {
    return Math.max(0, retryAfterSeconds * 1000);
  }
  return baseMs * Math.pow(2, attempt);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type DownloadUrlOptions = {
  maxRetries?: number;
  logContext?: Record<string, unknown>;
  /** Log prefix, e.g. "[Runway download]" */
  logLabel?: string;
};

/**
 * GET a URL with retries on 429/5xx and transient network errors.
 */
export async function downloadUrlWithRetries(
  url: string,
  options: DownloadUrlOptions = {}
): Promise<Buffer | null> {
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_HTTP_MAX_RETRIES);
  const logLabel = options.logLabel ?? "[HTTP download]";
  const logContext = options.logContext ?? {};

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }

      const retryAfter = res.headers.get("retry-after");
      const isRetryable = isRetryableHttpStatus(res.status);
      console.error(`${logLabel} failed`, {
        ...logContext,
        status: res.status,
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        retryAfter,
        isRetryable,
      });

      if (!isRetryable || attempt === maxRetries) {
        return null;
      }

      const waitMs = backoffMs(attempt, retryAfter);
      console.error(`${logLabel} backing off before retry`, {
        ...logContext,
        nextAttempt: attempt + 2,
        waitMs,
      });
      await sleep(waitMs);
    } catch (err) {
      const isLast = attempt === maxRetries;
      console.error(`${logLabel} network error`, {
        ...logContext,
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        error: err instanceof Error ? err.message : String(err),
        isLast,
      });
      if (isLast) return null;
      await sleep(backoffMs(attempt, null));
    }
  }

  return null;
}
