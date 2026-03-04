/**
 * Google Cloud Tasks: create queue per (userId, modelId) with model rate limit,
 * enqueue job processing task that hits our callback.
 */

import { CloudTasksClient } from "@google-cloud/tasks";
import { createHash } from "crypto";
import { getModelRateLimit } from "@/lib/video-models";

const projectId = process.env.GCP_PROJECT_ID;
const location = process.env.GCP_LOCATION ?? "us-central1";

/** Sanitize HOSTNAME for queue name: no protocol, no dots/special chars, [a-z0-9-], max 40 chars. */
function sanitizeHostname(host: string): string {
  const withoutProtocol = host.replace(/^https?:\/\//i, "").split("/")[0] ?? "";
  const sanitized = withoutProtocol.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (sanitized || "app").slice(0, 40);
}

/** Queue name must be 1-63 chars, [a-z0-9-]. Includes sanitized HOSTNAME + hash(userId:modelId). */
function queueIdFor(userId: string, modelId: string): string {
  const host = process.env.HOSTNAME ?? "";
  const prefix = `videitos-${sanitizeHostname(host)}`;
  const hash = createHash("sha256").update(`${userId}:${modelId}`).digest("hex").slice(0, 12);
  const id = `${prefix}-${hash}`;
  return id.length <= 63 ? id : `videitos-${hash}`;
}

/**
 * Parse GCP_SERVICE_ACCOUNT_JSON: raw JSON string or base64-encoded JSON.
 * Base64 is useful in .env to avoid escaping quotes (e.g. echo -n '<key.json' | base64).
 */
function parseServiceAccountJson(raw: string): object | null {
  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      return JSON.parse(s) as object;
    } catch {
      return null;
    }
  }
  try {
    const decoded = Buffer.from(s, "base64").toString("utf8");
    return decoded.startsWith("{") ? (JSON.parse(decoded) as object) : null;
  } catch {
    return null;
  }
}

/**
 * Build Cloud Tasks client. Credentials from env:
 * - GCP_SERVICE_ACCOUNT_JSON: full JSON key (minified single line) or base64-encoded JSON.
 * - If unset, uses Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or ADC).
 */
function getClient(): CloudTasksClient | null {
  if (!projectId) return null;
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const credentials = parseServiceAccountJson(raw);
    if (credentials) return new CloudTasksClient({ credentials });
    return null;
  }
  return new CloudTasksClient();
}

/**
 * Ensure queue exists for this user+model with rate limit from model config.
 * Then enqueue a task that POSTs to callbackUrl with body { jobId, callbackBaseUrl }.
 */
export async function enqueueJobTask(params: {
  userId: string;
  modelId: string;
  jobId: string;
  callbackBaseUrl: string;
}): Promise<boolean> {
  const { userId, modelId, jobId, callbackBaseUrl } = params;
  const client = getClient();
  if (!client) {
    console.error("[CloudTasks] GCP not configured (GCP_PROJECT_ID, optional GCP_SERVICE_ACCOUNT_JSON)");
    return false;
  }

  const queueId = queueIdFor(userId, modelId);
  const parent = client.queuePath(projectId!, location, queueId);
  const limit = getModelRateLimit(modelId);
  const maxDispatchesPerSecond = limit.requestsPerWindow / limit.windowSeconds;
  const maxConcurrentDispatches = Math.max(1, limit.requestsPerWindow);

  try {
    try {
      await client.getQueue({ name: parent });
    } catch {
      await client.createQueue({
        parent: client.locationPath(projectId!, location),
        queue: {
          name: parent,
          rateLimits: {
            maxDispatchesPerSecond,
            maxConcurrentDispatches,
          },
        },
      });
    }

    const callbackUrl = `${callbackBaseUrl.replace(/\/$/, "")}/api/jobs/process-task`;
    const body = Buffer.from(JSON.stringify({ jobId, callbackBaseUrl })).toString("base64");
    const secret = process.env.JOB_PROCESS_SECRET ?? "";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) headers["X-Job-Process-Secret"] = secret;

    await client.createTask({
      parent,
      task: {
        httpRequest: {
          url: callbackUrl,
          httpMethod: "POST" as const,
          headers,
          body,
        },
      },
    });
    return true;
  } catch (err) {
    console.error("[CloudTasks] enqueue failed:", err);
    return false;
  }
}
