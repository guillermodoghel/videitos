/**
 * Runway image-to-video API (POST /v1/image_to_video).
 * Uses user's Runway API key. Task is polled via GET /v1/tasks/{id}.
 *
 * Task statuses: PENDING → THROTTLED (concurrency) → RUNNING → SUCCEEDED | FAILED | CANCELLED.
 * `progress` (0–1) is only present while status is RUNNING.
 *
 * @see https://docs.dev.runwayml.com/api-details/sdks/
 * @see https://docs.dev.runwayml.com/usage/tiers/ (THROTTLED)
 */

const RUNWAY_API_BASE = "https://api.dev.runwayml.com";
const RUNWAY_VERSION = "2024-11-06";

export interface RunwayTaskStatus {
  done: boolean;
  videoUri?: string;
  error?: string;
  /** Raw Runway status: PENDING, RUNNING, THROTTLED, SUCCEEDED, FAILED, CANCELLED. */
  runwayStatus?: string;
  progress?: number;
}

import type { RunwayRatio } from "@/lib/video-models";
import { downloadUrlWithRetries, type DownloadUrlOptions } from "@/lib/http-retry";
import { classifyRunwayApiError, classifyRunwayTaskError } from "@/lib/runway-errors";
import { normalizeRunwayProgress } from "@/lib/runway-progress-display";

/** Map Veo aspect ratio to Runway ratio (image-to-video accepted values). */
export function aspectRatioToRunwayRatio(
  aspectRatio: "9:16" | "16:9"
): "1280:720" | "720:1280" {
  return aspectRatio === "16:9" ? "1280:720" : "720:1280";
}

/** Runway image-to-video model ids. */
export type RunwayImageToVideoModel = "gen4.5" | "gen4_turbo" | "veo3.1" | "veo3.1_fast";

/**
 * Start image-to-video generation. promptImage must be a data URI, HTTPS URL, or runway:// URI.
 * Returns task id for polling.
 * Gen4.5/Gen4 Turbo: duration 2–10, ratio from gen4 set. Veo 3.1/3.1 Fast: duration 4|6|8, ratio from veo set.
 */
export async function startRunwayImageToVideo(
  apiKey: string,
  params: {
    model: RunwayImageToVideoModel;
    promptText: string;
    promptImage: string;
    ratio: RunwayRatio;
    duration: number;
    /** Runway Veo 3.1 / 3.1 Fast: include audio (default true) */
    audio?: boolean;
  }
): Promise<{ taskId: string } | { error: string }> {
  const isVeo31 = params.model === "veo3.1" || params.model === "veo3.1_fast";
  const duration = isVeo31
    ? (Math.round(params.duration) === 6 ? 6 : Math.round(params.duration) === 4 ? 4 : 8) as 4 | 6 | 8
    : (Math.min(10, Math.max(2, Math.round(params.duration))) as 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10);

  const body: Record<string, unknown> = {
    model: params.model,
    promptText: params.promptText.slice(0, 1000),
    promptImage: params.promptImage,
    ratio: params.ratio,
    duration,
  };
  if (params.model === "veo3.1" || params.model === "veo3.1_fast") {
    body.audio = params.audio !== false;
  }

  const res = await fetch(`${RUNWAY_API_BASE}/v1/image_to_video`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Runway-Version": RUNWAY_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: classifyRunwayApiError(res.status, text) };
  }

  let data: { id?: string };
  try {
    data = await res.json();
  } catch {
    return { error: "Invalid Runway response" };
  }

  const taskId = data.id;
  if (!taskId || typeof taskId !== "string") {
    return { error: "No task id in Runway response" };
  }
  return { taskId };
}

function parseRunwayTaskResponse(data: {
  status?: string;
  output?: unknown;
  artifacts?: unknown;
  error?: string;
  failure?: string;
  failureCode?: string;
  progress?: number;
}): RunwayTaskStatus {
  const runwayStatus = (data.status ?? "UNKNOWN").toUpperCase();
  // progress is only present on RUNNING tasks (Runway API / official SDK).
  const rawProgress =
    runwayStatus === "RUNNING" && typeof data.progress === "number"
      ? data.progress
      : undefined;
  const progress =
    rawProgress !== undefined
      ? normalizeRunwayProgress(rawProgress, runwayStatus) ?? undefined
      : undefined;

  if (runwayStatus === "SUCCEEDED") {
    const url =
      extractRunwayOutputUrl(data.output) ?? extractRunwayOutputUrl(data.artifacts);
    if (url) {
      return { done: true, videoUri: url, runwayStatus, progress };
    }
    return { done: true, error: "No output URL in Runway response", runwayStatus, progress };
  }
  if (runwayStatus === "FAILED" || runwayStatus === "CANCELLED" || runwayStatus === "CANCELED") {
    const raw =
      typeof data.failure === "string"
        ? data.failure
        : typeof data.error === "string"
          ? data.error
          : data.failureCode
            ? `Task failed (${data.failureCode})`
            : "Task failed";
    return { done: true, error: classifyRunwayTaskError(raw), runwayStatus, progress };
  }

  return { done: false, runwayStatus, progress };
}

async function fetchRunwayTask(
  apiKey: string,
  taskId: string
): Promise<Response> {
  return fetch(`${RUNWAY_API_BASE}/v1/tasks/${taskId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Runway-Version": RUNWAY_VERSION,
    },
  });
}

/**
 * Get Runway task status. Retries once on HTTP or network failure.
 */
export async function getRunwayTaskStatus(
  apiKey: string,
  taskId: string
): Promise<RunwayTaskStatus> {
  let lastHttpStatus: number | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchRunwayTask(apiKey, taskId);
      if (!res.ok) {
        lastHttpStatus = res.status;
        if (attempt === 0) continue;
        return {
          done: true,
          error: `Runway task fetch failed: ${res.status}`,
        };
      }

      let data: {
        status?: string;
        output?: unknown;
        artifacts?: unknown;
        error?: string;
        failure?: string;
        failureCode?: string;
        progress?: number;
      };
      try {
        data = await res.json();
      } catch {
        if (attempt === 0) continue;
        return { done: true, error: "Invalid Runway task response" };
      }

      return parseRunwayTaskResponse(data);
    } catch {
      if (attempt === 0) continue;
      return {
        done: true,
        error: `Runway task fetch failed${lastHttpStatus != null ? `: ${lastHttpStatus}` : ""}`,
      };
    }
  }

  return { done: true, error: "Runway task fetch failed" };
}

/**
 * Cancel or delete a Runway task (DELETE /v1/tasks/{id}). 404 is treated as success.
 */
export async function cancelRunwayTask(
  apiKey: string,
  taskId: string
): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(`${RUNWAY_API_BASE}/v1/tasks/${taskId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Runway-Version": RUNWAY_VERSION,
      },
    });
    return { ok: res.status === 204 || res.status === 404, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Runway may return output as string URLs or objects with url/uri. */
function extractRunwayOutputUrl(output: unknown): string | undefined {
  if (typeof output === "string" && output.startsWith("http")) {
    return output;
  }
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    if (typeof item === "string" && item.startsWith("http")) return item;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (typeof record.url === "string" && record.url.startsWith("http")) return record.url;
      if (typeof record.uri === "string" && record.uri.startsWith("http")) return record.uri;
    }
  }
  return undefined;
}

/**
 * Download video from Runway output URL. URLs are often signed (e.g. with _jwt) and may not need auth.
 */
export async function downloadRunwayVideo(
  _apiKey: string,
  videoUri: string,
  options: DownloadUrlOptions = {}
): Promise<Buffer | null> {
  return downloadUrlWithRetries(videoUri, {
    ...options,
    logLabel: options.logLabel ?? "[Runway download]",
  });
}

/** Ratio for text_to_image gen4_image_turbo (subset used for consistency with video). */
export type RunwayTextToImageRatio = "1280:720" | "720:1280";

/**
 * Start text-to-image generation (POST /v1/text_to_image).
 * model gen4_image_turbo: promptText, ratio, referenceImages (1–3) required.
 * Optional tag per ref (e.g. "character" for Dropbox upload); contentModeration.publicFigureThreshold "low".
 */
export async function startRunwayTextToImage(
  apiKey: string,
  params: {
    promptText: string;
    ratio: RunwayTextToImageRatio;
    referenceImages: { uri: string; tag?: string }[];
  }
): Promise<{ taskId: string } | { error: string }> {
  if (params.referenceImages.length < 1 || params.referenceImages.length > 3) {
    return { error: "referenceImages must have 1 to 3 items" };
  }

  const res = await fetch(`${RUNWAY_API_BASE}/v1/text_to_image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Runway-Version": RUNWAY_VERSION,
    },
    body: JSON.stringify({
      model: "gen4_image_turbo",
      promptText: params.promptText,
      ratio: params.ratio,
      referenceImages: params.referenceImages,
      contentModeration: { publicFigureThreshold: "low" as const },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: classifyRunwayApiError(res.status, text) };
  }

  let data: { id?: string };
  try {
    data = await res.json();
  } catch {
    return { error: "Invalid Runway response" };
  }

  const taskId = data.id;
  if (!taskId || typeof taskId !== "string") {
    return { error: "No task id in Runway response" };
  }
  return { taskId };
}

/** Poll interval and max wait for image task (pre-gen step). */
const IMAGE_TASK_POLL_MS = 3000;
const IMAGE_TASK_MAX_WAIT_MS = 120_000;

/**
 * Run text-to-image, poll until done, return output image URL or error.
 */
export async function runRunwayTextToImageAndWait(
  apiKey: string,
  params: {
    promptText: string;
    ratio: RunwayTextToImageRatio;
    referenceImages: { uri: string; tag?: string }[];
  }
): Promise<{ imageUri: string } | { error: string }> {
  const start = await startRunwayTextToImage(apiKey, params);
  if ("error" in start) return start;

  const deadline = Date.now() + IMAGE_TASK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const status = await getRunwayTaskStatus(apiKey, start.taskId);
    if (status.done) {
      if (status.error) return { error: status.error };
      if (status.videoUri) return { imageUri: status.videoUri };
      return { error: "No output URL in Runway response" };
    }
    await new Promise((r) => setTimeout(r, IMAGE_TASK_POLL_MS));
  }
  return { error: "Text-to-image task timed out" };
}
