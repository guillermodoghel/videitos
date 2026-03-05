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

/** Map Veo aspect ratio to Runway ratio (image-to-video accepted values). */
export function aspectRatioToRunwayRatio(
  aspectRatio: "9:16" | "16:9"
): "1280:720" | "720:1280" {
  return aspectRatio === "16:9" ? "1280:720" : "720:1280";
}

/** Runway image-to-video model ids. */
export type RunwayImageToVideoModel = "gen4.5" | "gen4_turbo" | "veo3.1_fast";

/** Ratio for gen4.5 / gen4_turbo. veo3.1_fast also supports 1080:1920, 1920:1080. */
export type RunwayRatio = "1280:720" | "720:1280" | "1080:1920" | "1920:1080";

/**
 * Start image-to-video generation. promptImage must be a data URI, HTTPS URL, or runway:// URI.
 * Returns task id for polling.
 * veo3.1_fast: duration must be 4, 6, or 8; audio defaults to true.
 */
export async function startRunwayImageToVideo(
  apiKey: string,
  params: {
    model: RunwayImageToVideoModel;
    promptText: string;
    promptImage: string;
    ratio: RunwayRatio;
    duration: number;
    /** Runway Veo 3.1 Fast only: include audio (default false = muted) */
    audio?: boolean;
  }
): Promise<{ taskId: string } | { error: string }> {
  const isVeo31Fast = params.model === "veo3.1_fast";
  const duration = isVeo31Fast
    ? (Math.round(params.duration) === 6 ? 6 : Math.round(params.duration) === 4 ? 4 : 8) as 4 | 6 | 8
    : (Math.min(10, Math.max(2, Math.round(params.duration))) as 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10);

  const body: Record<string, unknown> = {
    model: params.model,
    promptText: params.promptText,
    promptImage: params.promptImage,
    ratio: params.ratio,
    duration,
  };
  if (isVeo31Fast) {
    body.audio = params.audio === true;
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
