import { createHmac, timingSafeEqual } from "crypto";

function thumbnailSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  return secret;
}

/** Stable per job (same URL forever) so Vercel Image CDN can cache across polls. */
export function signJobThumbnailToken(jobId: string): string {
  return createHmac("sha256", thumbnailSecret())
    .update(`job-thumb:${jobId}`)
    .digest("base64url");
}

export function verifyJobThumbnailToken(
  jobId: string,
  token: string | null | undefined
): boolean {
  if (!token?.trim()) return false;
  const expected = signJobThumbnailToken(jobId);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function buildJobThumbnailUrl(jobId: string): string {
  const t = signJobThumbnailToken(jobId);
  return `/api/jobs/${jobId}/thumbnail?t=${encodeURIComponent(t)}`;
}
