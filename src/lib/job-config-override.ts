import type { VeoConfig } from "@/lib/video-models";

export const JOB_PROMPT_MAX_LENGTH = 1000;

export type JobConfigOverride = {
  prompt?: string;
};

/** Parse stored override or API body; null if absent/invalid. */
export function parseJobConfigOverride(value: unknown): JobConfigOverride | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.prompt !== "string") return null;
  const prompt = o.prompt.trim();
  if (!prompt) return null;
  if (prompt.length > JOB_PROMPT_MAX_LENGTH) return null;
  return { prompt };
}

/** Validate prompt from retake API body; returns override or error message. */
export function parseRetakePromptBody(
  body: unknown
): { ok: true; override: JobConfigOverride } | { ok: false; error: string } {
  if (body == null || (typeof body === "object" && Object.keys(body as object).length === 0)) {
    return { ok: true, override: {} };
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const prompt = (body as { prompt?: unknown }).prompt;
  if (prompt === undefined) {
    return { ok: true, override: {} };
  }
  if (typeof prompt !== "string") {
    return { ok: false, error: "prompt must be a string" };
  }
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { ok: false, error: "prompt cannot be empty" };
  }
  if (trimmed.length > JOB_PROMPT_MAX_LENGTH) {
    return { ok: false, error: `prompt must be at most ${JOB_PROMPT_MAX_LENGTH} characters` };
  }
  return { ok: true, override: { prompt: trimmed } };
}

/** Apply per-job video prompt override on top of template config. */
export function applyJobConfigOverride(
  config: VeoConfig,
  override: JobConfigOverride | null
): VeoConfig {
  const prompt = override?.prompt?.trim();
  if (!prompt) return config;
  return { ...config, prompt };
}

/** Stored override for DB: null when empty, else { prompt }. */
export function jobConfigOverrideForDb(
  override: JobConfigOverride | null | undefined
): JobConfigOverride | null {
  const prompt = override?.prompt?.trim();
  if (!prompt) return null;
  return { prompt };
}
