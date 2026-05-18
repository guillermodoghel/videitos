import { JOB_ERROR } from "@/lib/constants/job-error-messages";

/** Classify Runway HTTP error body (402 = out of API credits, 429 = rate limit). */
export function classifyRunwayApiError(status: number, body: string): string {
  const text = body.trim();
  const lower = text.toLowerCase();

  if (status === 429) return "rate_limit";
  if (status === 402) return JOB_ERROR.RUNWAY_INSUFFICIENT_CREDITS_CODE;

  if (isRunwayInsufficientCreditsMessage(text)) {
    return JOB_ERROR.RUNWAY_INSUFFICIENT_CREDITS_CODE;
  }

  return text || (status > 0 ? `Runway API ${status}` : "Runway API error");
}

/** Classify error string from a failed Runway task poll. */
export function classifyRunwayTaskError(message: string): string {
  if (isRunwayInsufficientCreditsMessage(message)) {
    return JOB_ERROR.RUNWAY_INSUFFICIENT_CREDITS_CODE;
  }
  return message;
}

/** True for Runway API / task errors that mean the Runway org is out of credits. */
export function isRunwayInsufficientCreditsError(error: string): boolean {
  if (error === JOB_ERROR.RUNWAY_INSUFFICIENT_CREDITS_CODE) return true;
  return isRunwayInsufficientCreditsMessage(error);
}

function isRunwayInsufficientCreditsMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("insufficient credit") ||
    lower.includes("not enough credit") ||
    lower.includes("out of credit") ||
    lower.includes("ran out of credit") ||
    lower.includes("no credit") ||
    (lower.includes("billing") && lower.includes("credit")) ||
    lower.includes("payment required") ||
    /\b402\b/.test(lower)
  );
}
