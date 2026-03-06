/**
 * Resolve which Runway API key to use for a job.
 * - If the user has their own key: use it (no credit deduction).
 * - If not: use the first admin's key (platform key); credits are required and deducted.
 */

import { prisma } from "@/lib/prisma";

let platformKeyCache: string | null | undefined = undefined;

/**
 * Get the platform Runway API key (first admin with a key). Cached in process.
 */
export async function getPlatformRunwayApiKey(): Promise<string | null> {
  if (platformKeyCache !== undefined) return platformKeyCache;
  const admin = await prisma.user.findFirst({
    where: { role: "admin", runwayApiKey: { not: null } },
    select: { runwayApiKey: true },
  });
  platformKeyCache = admin?.runwayApiKey ?? null;
  return platformKeyCache;
}

/**
 * Return the Runway API key to use for this user.
 * - If user has runwayApiKey: return it (user pays Runway directly; we don't deduct credits).
 * - Else: return platform key (we deduct credits; requires an admin to have set their key).
 */
export async function getRunwayApiKeyForUser(userRunwayApiKey: string | null): Promise<string | null> {
  if (userRunwayApiKey?.trim()) return userRunwayApiKey.trim();
  return getPlatformRunwayApiKey();
}

/**
 * True if the job will use the platform key (user has no key) and thus credits will be charged.
 */
export function usesPlatformKey(userRunwayApiKey: string | null): boolean {
  return !userRunwayApiKey?.trim();
}
