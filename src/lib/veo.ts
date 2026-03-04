/**
 * Veo video generation via Google GenAI (Gemini API).
 * Uses user's Google AI Studio API key; poll operation until done, then get video URI.
 */

import {
  GoogleGenAI,
  GenerateVideosOperation,
  VideoGenerationReferenceType,
} from "@google/genai";
import type { VeoConfig } from "./video-models";

const VEO_MODEL = "veo-3.1-generate-preview";

export interface VeoOperationStatus {
  done: boolean;
  videoUri?: string;
  error?: string;
}

/** Get status of a video generation operation. Use jobId to resolve user API key in the route. */
export async function getVeoOperationStatus(
  apiKey: string,
  operationName: string
): Promise<VeoOperationStatus> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const operation = new GenerateVideosOperation();
    (operation as { name?: string }).name = operationName;
    const op = await ai.operations.getVideosOperation({
      operation,
    });
    if (op.error) {
      const errMsg =
        typeof op.error.message === "string"
          ? op.error.message
          : JSON.stringify(op.error);
      return { done: true, error: errMsg };
    }
    if (!op.done) {
      return { done: false };
    }
    const video = op.response?.generatedVideos?.[0]?.video;
    const uri = video?.uri;
    if (uri) return { done: true, videoUri: uri };
    return { done: true, error: "No video in response" };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const msg = err.message;
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[getVeoOperationStatus] failed", {
      operationName,
      message: msg,
      stack,
      name: err.name,
    });
    return { done: true, error: `Veo status check failed: ${msg}` };
  }
}

export interface StartVeoParams {
  prompt: string;
  config: VeoConfig;
  /** Up to 3 images: base64, mimeType. Typically 2 ref + 1 new (from Dropbox). */
  images: { imageBytes: string; mimeType: string }[];
}

/** Start video generation; returns operation name for polling. */
export async function startVeoGeneration(
  apiKey: string,
  params: StartVeoParams
): Promise<{ operationName: string } | { error: string }> {
  const ai = new GoogleGenAI({ apiKey });
  const { prompt, config, images } = params;

  const referenceImages = images.slice(0, 3).map((img) => ({
    image: {
      imageBytes: img.imageBytes,
      mimeType: img.mimeType as "image/png" | "image/jpeg" | "image/webp",
    },
    referenceType: VideoGenerationReferenceType.ASSET,
  }));

  try {
    const operation = await ai.models.generateVideos({
      model: VEO_MODEL,
      source: {
        prompt,
      },
      config: {
        aspectRatio: config.aspectRatio,
        resolution: config.resolution,
        durationSeconds: config.durationSeconds,
        numberOfVideos: 1,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      },
    });

    const name = operation.name;
    if (!name) return { error: "No operation name returned" };
    return { operationName: name };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

/** Download video from Veo URI. URI may require API key in query. Returns buffer or null. */
export async function downloadVeoVideo(
  apiKey: string,
  videoUri: string
): Promise<Buffer | null> {
  try {
    const url = videoUri.includes("?")
      ? `${videoUri}&key=${encodeURIComponent(apiKey)}`
      : `${videoUri}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf);
  } catch {
    return null;
  }
}
