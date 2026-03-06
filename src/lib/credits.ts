import { parseTemplateConfig } from "@/lib/video-models";

/**
 * Credit system: API cost constants and our pricing (multiplier).
 * Costs are in "credits" (decimal-friendly; store in DB as Prisma Decimal).
 *
 * API costs (what we pay):
 * - gen4.5: 12 credits/sec
 * - gen4_turbo: 5 credits/sec
 * - veo3.1 (audio): 40 credits/sec, (no audio): 20 credits/sec
 * - veo3.1_fast (audio): 15 credits/sec, (no audio): 10 credits/sec
 * - gen4_image_turbo: 2 credits per image (pre-gen)
 *
 * We charge CREDIT_MULTIPLIER × API cost.
 */

/** Multiplier applied to API cost for user-facing credits (e.g. 2.5 = charge 2.5×). */
export const CREDIT_MULTIPLIER = 2.5;

/** API credits per second by model. veo3.1/veo3.1_fast depend on audio. */
export const API_CREDITS_PER_SECOND: Record<
  string,
  { withAudio: number; noAudio: number } | number
> = {
  "gen4.5": 12,
  gen4_turbo: 5,
  "veo3.1": { withAudio: 40, noAudio: 20 },
  "veo3.1_fast": { withAudio: 15, noAudio: 10 },
};

/** API credits per pre-gen image (gen4_image_turbo). */
export const API_CREDITS_PER_PREGEN_IMAGE = 2;

export type JobCostInput = {
  model: string;
  durationSeconds: number;
  /** Only for veo3.1 / veo3.1_fast; ignored for gen4. */
  audio?: boolean;
  /** True if job used pre-gen (text-to-image). */
  hasPreGen?: boolean;
};

export interface JobCostResult {
  /** API cost (what we pay). */
  apiCost: number;
  /** User cost (what we charge: apiCost × CREDIT_MULTIPLIER). */
  creditCost: number;
}

function getApiCreditsPerSecond(model: string, audio: boolean): number {
  const val = API_CREDITS_PER_SECOND[model];
  if (val == null) return 0;
  if (typeof val === "number") return val;
  return audio ? val.withAudio : val.noAudio;
}

/**
 * Compute API cost and user credit cost for a job.
 * Used when reserving/checking balance and when recording cost on completion.
 */
export function computeJobCost(input: JobCostInput): JobCostResult {
  const { model, durationSeconds, hasPreGen = false } = input;
  const audio = input.audio !== false && (model === "veo3.1" || model === "veo3.1_fast");
  const perSecond = getApiCreditsPerSecond(model, audio);
  const videoApi = perSecond * durationSeconds;
  const preGenApi = hasPreGen ? API_CREDITS_PER_PREGEN_IMAGE : 0;
  const apiCost = videoApi + preGenApi;
  const creditCost = apiCost * CREDIT_MULTIPLIER;
  return { apiCost, creditCost };
}

/**
 * Estimated credits per video for a template, based on its model and config.
 * Uses parseTemplateConfig for duration, audio, and preGen. Safe to call with any config shape.
 */
export function getTemplateEstimatedCredits(
  model: string,
  config: unknown
): number {
  const parsed = parseTemplateConfig(model, config);
  const hasPreGen = !!(
    parsed.preGen?.prompt &&
    parsed.preGen.referenceImageUrls &&
    parsed.preGen.referenceImageUrls.length >= 1
  );
  const { creditCost } = computeJobCost({
    model,
    durationSeconds: parsed.durationSeconds,
    audio: parsed.audio,
    hasPreGen,
  });
  return creditCost;
}
