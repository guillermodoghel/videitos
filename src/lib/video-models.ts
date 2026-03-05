/**
 * Video generation models config.
 * Based on: https://ai.google.dev/gemini-api/docs/video
 */

/** Per-model rate limit: N requests per window (e.g. 2 per 60s). */
export interface ModelRateLimit {
  /** Max requests allowed in the window. */
  requestsPerWindow: number;
  /** Window duration in seconds. */
  windowSeconds: number;
}

export const RUNWAY_IMAGE_TO_VIDEO_IDS = ["gen4.5", "gen4_turbo", "veo3.1_fast"] as const;

export const VIDEO_MODELS = [
  {
    id: "gen4.5",
    name: "Runway Gen-4.5",
    description: "Image-to-video from Dropbox source image (no reference images)",
    rateLimit: {
      requestsPerWindow: 1,
      windowSeconds: 1,
    } satisfies ModelRateLimit,
  },
  {
    id: "gen4_turbo",
    name: "Runway Gen-4 Turbo",
    description: "Image-to-video from Dropbox source image (no reference images)",
    rateLimit: {
      requestsPerWindow: 1,
      windowSeconds: 1,
    } satisfies ModelRateLimit,
  },
  {
    id: "veo3.1_fast",
    name: "Runway Veo 3.1 Fast",
    description: "Image-to-video from Dropbox source image (4/6/8s, optional audio)",
    rateLimit: {
      requestsPerWindow: 1,
      windowSeconds: 1,
    } satisfies ModelRateLimit,
  },
] as const;

/** True if model uses Runway image-to-video (Dropbox image = promptImage only, no template reference images). */
export function isRunwayImageToVideoModel(modelId: string): boolean {
  return (RUNWAY_IMAGE_TO_VIDEO_IDS as readonly string[]).includes(modelId);
}

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];

/** Optional pre-generation: generate an image from prompt + refs, then use as first frame for video. */
export interface PreGenConfig {
  prompt: string;
  /** S3 keys for 1–2 reference images (Runway text_to_image allows 1–3). */
  referenceImageUrls: string[];
}

/** Veo 3.1 config shape (prompt, aspect ratio, resolution, duration, optional reference images) */
export interface VeoConfig {
  prompt: string;
  aspectRatio: "9:16" | "16:9";
  resolution: "720p" | "1080p" | "4k";
  durationSeconds: 4 | 6 | 8;
  /** Up to 2 reference image URLs (user-provided or uploaded) */
  referenceImageUrls?: string[];
  /** Runway Veo 3.1 Fast only: include audio in generated video (default false = muted) */
  audio?: boolean;
  /** Optional: generate image from prompt + refs first, use that image as video first frame. */
  preGen?: PreGenConfig;
}

export const VEO_DEFAULTS: VeoConfig = {
  prompt: "",
  aspectRatio: "9:16",
  resolution: "720p",
  durationSeconds: 8,
  referenceImageUrls: [],
};

export const ASPECT_RATIOS: { value: VeoConfig["aspectRatio"]; label: string }[] = [
  { value: "9:16", label: "9:16 (vertical)" },
  { value: "16:9", label: "16:9 (horizontal)" },
];

export const RESOLUTIONS: { value: VeoConfig["resolution"]; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "4k", label: "4K" },
];

export const DURATIONS: { value: VeoConfig["durationSeconds"]; label: string }[] = [
  { value: 4, label: "4 seconds" },
  { value: 6, label: "6 seconds" },
  { value: 8, label: "8 seconds" },
];

export function getModelById(id: string) {
  return VIDEO_MODELS.find((m) => m.id === id) ?? null;
}

/** Default rate limit when model is unknown (conservative: 1 per 60s). */
const DEFAULT_RATE_LIMIT: ModelRateLimit = {
  requestsPerWindow: 1,
  windowSeconds: 60,
};

export function getModelRateLimit(modelId: string): ModelRateLimit {
  const model = getModelById(modelId);
  return model?.rateLimit ?? DEFAULT_RATE_LIMIT;
}

export function parseTemplateConfig(modelId: string, config: unknown): VeoConfig {
  const base = { ...VEO_DEFAULTS };
  if (config && typeof config === "object") {
    const c = config as Record<string, unknown>;
    if (typeof c.prompt === "string") base.prompt = c.prompt;
    if (c.aspectRatio === "16:9" || c.aspectRatio === "9:16") base.aspectRatio = c.aspectRatio;
    if (c.resolution === "720p" || c.resolution === "1080p" || c.resolution === "4k") base.resolution = c.resolution;
    if (c.durationSeconds === 4 || c.durationSeconds === 6 || c.durationSeconds === 8) base.durationSeconds = c.durationSeconds;
    if (isRunwayImageToVideoModel(modelId)) {
      base.referenceImageUrls = [];
      if (modelId === "veo3.1_fast" && typeof c.audio === "boolean") base.audio = c.audio;
      if (c.preGen && typeof c.preGen === "object") {
        const pg = c.preGen as Record<string, unknown>;
        const prompt = typeof pg.prompt === "string" ? pg.prompt : "";
        const refs = Array.isArray(pg.referenceImageUrls)
          ? pg.referenceImageUrls.filter((u): u is string => typeof u === "string").slice(0, 3)
          : [];
        if (prompt || refs.length > 0) {
          base.preGen = { prompt, referenceImageUrls: refs };
        }
      }
    }
  }
  return base;
}
