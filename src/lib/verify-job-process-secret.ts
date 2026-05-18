import type { NextRequest } from "next/server";

export function verifyJobProcessSecret(request: NextRequest): boolean {
  const secret =
    request.headers.get("x-internal-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.JOB_PROCESS_SECRET;
  return !!expected && secret === expected;
}
