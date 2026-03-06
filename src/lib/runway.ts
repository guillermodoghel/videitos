/**
 * Runway image-to-video API (POST /v1/image_to_video).
 * Uses user's Runway API key. Task is polled via GET /v1/tasks/{id}.
 * @see https://docs.dev.runwayml.com/api/#tag/Start-generating/paths/~1v1~1image_to_video/post
 */

const RUNWAY_API_BASE = "https://api.dev.runwayml.com";
const RUNWAY_VERSION = "2024-11-06";

export interface RunwayTaskStatus {
  done: boolean;
  videoUri?: string;
  error?: string;
}

import type { RunwayRatio } from "@/lib/video-models";

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
    const isRateLimit = res.status === 429;
    return {
      error: isRateLimit ? "rate_limit" : text || `Runway API ${res.status}`,
    };
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

/**
 * Get Runway task status. Returns shape compatible with Veo status for Step Function.
 */
export async function getRunwayTaskStatus(
  apiKey: string,
  taskId: string
): Promise<RunwayTaskStatus> {
  const res = await fetch(`${RUNWAY_API_BASE}/v1/tasks/${taskId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Runway-Version": RUNWAY_VERSION,
    },
  });

  if (!res.ok) {
    return {
      done: true,
      error: `Runway task fetch failed: ${res.status}`,
    };
  }

  let data: { status?: string; output?: string[]; error?: string };
  try {
    data = await res.json();
  } catch {
    return { done: true, error: "Invalid Runway task response" };
  }

  const status = (data.status ?? "").toUpperCase();
  if (status === "SUCCEEDED") {
    const url = Array.isArray(data.output) && data.output.length > 0 ? data.output[0] : undefined;
    if (url && typeof url === "string") {
      return { done: true, videoUri: url };
    }
    return { done: true, error: "No output URL in Runway response" };
  }
  if (status === "FAILED" || status === "CANCELLED") {
    const err = typeof data.error === "string" ? data.error : "Task failed";
    return { done: true, error: err };
  }

  return { done: false };
}

/**
 * Download video from Runway output URL. URLs are often signed (e.g. with _jwt) and may not need auth.
 */
export async function downloadRunwayVideo(
  _apiKey: string,
  videoUri: string
): Promise<Buffer | null> {
  try {
    const res = await fetch(videoUri, { method: "GET" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf);
  } catch {
    return null;
  }
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
    const isRateLimit = res.status === 429;
    return {
      error: isRateLimit ? "rate_limit" : text || `Runway API ${res.status}`,
    };
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
