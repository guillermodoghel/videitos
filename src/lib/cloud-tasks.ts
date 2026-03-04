/**
 * Google Cloud Tasks via REST API (no @google-cloud/tasks dependency).
 * Create queue per (userId, modelId) with model rate limit; enqueue task to our callback.
 */

import { createHash } from "crypto";
import { SignJWT, importPKCS8 } from "jose";
import { getModelRateLimit } from "@/lib/video-models";

const projectId = process.env.GCP_PROJECT_ID;
const location = process.env.GCP_LOCATION ?? "us-central1";
const CLOUD_TASKS_SCOPE = "https://www.googleapis.com/auth/cloud-tasks";

/** Sanitize HOSTNAME for queue name: no protocol, no dots/special chars, [a-z0-9-], max 40 chars. */
function sanitizeHostname(host: string): string {
  const withoutProtocol = host.replace(/^https?:\/\//i, "").split("/")[0] ?? "";
  const sanitized = withoutProtocol.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (sanitized || "app").slice(0, 40);
}

/** Queue ID: 1-63 chars, [a-z0-9-]. Includes sanitized HOSTNAME + hash(userId:modelId). */
function queueIdFor(userId: string, modelId: string): string {
  const host = process.env.HOSTNAME ?? "";
  const prefix = `videitos-${sanitizeHostname(host)}`;
  const hash = createHash("sha256").update(`${userId}:${modelId}`).digest("hex").slice(0, 12);
  const id = `${prefix}-${hash}`;
  return id.length <= 63 ? id : `videitos-${hash}`;
}

/**
 * Parse GCP_SERVICE_ACCOUNT_JSON: raw JSON string or base64-encoded JSON.
 */
function parseServiceAccountJson(raw: string): { client_email: string; private_key: string } | null {
  const s = raw.trim();
  let obj: unknown;
  if (s.startsWith("{")) {
    try {
      obj = JSON.parse(s);
    } catch {
      return null;
    }
  } else {
    try {
      const decoded = Buffer.from(s, "base64").toString("utf8");
      obj = decoded.startsWith("{") ? JSON.parse(decoded) : null;
    } catch {
      return null;
    }
  }
  if (obj && typeof obj === "object" && "client_email" in obj && "private_key" in obj) {
    return obj as { client_email: string; private_key: string };
  }
  return null;
}

/** Get OAuth2 access token for Cloud Tasks using service account JWT. */
async function getAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const key = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: CLOUD_TASKS_SCOPE })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth2 token failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google OAuth2: no access_token");
  return data.access_token;
}

function queuePath(queueId: string): string {
  return `projects/${projectId}/locations/${location}/queues/${queueId}`;
}

function locationPath(): string {
  return `projects/${projectId}/locations/${location}`;
}

async function getQueue(accessToken: string, queueId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`https://cloudtasks.googleapis.com/v2/${queuePath(queueId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { ok: res.ok };
}

async function createQueue(
  accessToken: string,
  queueId: string,
  rateLimits: { maxDispatchesPerSecond: number; maxConcurrentDispatches: number }
): Promise<void> {
  const res = await fetch(`https://cloudtasks.googleapis.com/v2/${locationPath()}/queues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: queuePath(queueId),
      rateLimits,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cloud Tasks createQueue failed: ${res.status} ${text}`);
  }
}

async function createTask(
  accessToken: string,
  queueId: string,
  task: { httpRequest: { url: string; httpMethod: string; headers: Record<string, string>; body: string } }
): Promise<void> {
  const res = await fetch(`https://cloudtasks.googleapis.com/v2/${queuePath(queueId)}/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ task }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cloud Tasks createTask failed: ${res.status} ${text}`);
  }
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
  if (!projectId) {
    console.error("[CloudTasks] GCP_PROJECT_ID not set");
    return false;
  }
  const sa = process.env.GCP_SERVICE_ACCOUNT_JSON
    ? parseServiceAccountJson(process.env.GCP_SERVICE_ACCOUNT_JSON)
    : null;
  if (!sa) {
    console.error("[CloudTasks] GCP_SERVICE_ACCOUNT_JSON not set or invalid (required in serverless)");
    return false;
  }

  const queueId = queueIdFor(userId, modelId);
  const limit = getModelRateLimit(modelId);
  const maxDispatchesPerSecond = limit.requestsPerWindow / limit.windowSeconds;
  const maxConcurrentDispatches = Math.max(1, limit.requestsPerWindow);

  try {
    const accessToken = await getAccessToken(sa);

    const { ok: queueExists } = await getQueue(accessToken, queueId);
    if (!queueExists) {
      await createQueue(accessToken, queueId, {
        maxDispatchesPerSecond,
        maxConcurrentDispatches,
      });
    }

    const callbackUrl = `${callbackBaseUrl.replace(/\/$/, "")}/api/jobs/process-task`;
    const body = Buffer.from(JSON.stringify({ jobId, callbackBaseUrl })).toString("base64");
    const secret = process.env.JOB_PROCESS_SECRET ?? "";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) headers["X-Job-Process-Secret"] = secret;

    await createTask(accessToken, queueId, {
      httpRequest: {
        url: callbackUrl,
        httpMethod: "POST",
        headers,
        body,
      },
    });
    return true;
  } catch (err) {
    console.error("[CloudTasks] enqueue failed:", err);
    return false;
  }
}
