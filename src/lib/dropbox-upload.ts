/**
 * Dropbox file upload (simple + session for videos > 150 MB).
 */

import { ensureDropboxPath } from "@/lib/dropbox-path";
import { DROPBOX_MAX_INLINE_BACKOFF_MS, DropboxRateLimitError } from "@/lib/dropbox-rate-limit";
import {
  backoffMs,
  DEFAULT_HTTP_MAX_RETRIES,
  isRetryableHttpStatus,
  sleep,
} from "@/lib/http-retry";

const DROPBOX_CONTENT = "https://content.dropboxapi.com/2";

/** Dropbox simple upload limit is 150 MB; use sessions above this threshold. */
export const DROPBOX_SIMPLE_UPLOAD_MAX_BYTES = 140 * 1024 * 1024;

const DROPBOX_SESSION_CHUNK_BYTES = 8 * 1024 * 1024;

export type DropboxUploadResult =
  | { ok: true; path_display: string }
  | { ok: false; reason: string; status?: number };

export type DropboxUploadOptions = {
  mode?: "add" | "overwrite";
  onUnauthorized?: () => Promise<string | null>;
  maxRetries?: number;
  logContext?: Record<string, unknown>;
};

function toLatin1Header(s: string): string {
  return Array.from(s, (ch) => {
    const code = ch.codePointAt(0)!;
    return code <= 255 ? ch : "?";
  }).join("");
}

function sanitizePathForHeader(path: string): string {
  const normalized = path.replace(/\u202F/g, " ").replace(/\s/g, " ");
  return toLatin1Header(normalized);
}

function dropboxWriteMode(mode: "add" | "overwrite"): { ".tag": "add" | "overwrite" } {
  return { ".tag": mode };
}

function parseDropboxError(errJson: unknown, errText: string): {
  errorSummary?: string;
  errorTag?: string;
} {
  if (!errJson || typeof errJson !== "object") {
    return {};
  }
  const o = errJson as Record<string, unknown>;
  const summary = typeof o.error_summary === "string" ? o.error_summary : undefined;
  const err = o.error;
  let errorTag: string | undefined;
  if (err && typeof err === "object") {
    const tag = (err as { ".tag"?: string })[".tag"];
    if (typeof tag === "string") errorTag = tag;
  }
  return { errorSummary: summary, errorTag };
}

function failureReason(errJson: unknown, errText: string, status: number): string {
  const parsed = parseDropboxError(errJson, errText);
  return parsed.errorSummary ?? parsed.errorTag ?? `HTTP ${status}`;
}

function isDropboxPathConflict(status: number, errJson: unknown): boolean {
  if (status === 409) return true;
  if (!errJson || typeof errJson !== "object") return false;
  const summary = (errJson as { error_summary?: string }).error_summary;
  if (typeof summary === "string" && summary.startsWith("path/conflict")) {
    return true;
  }
  const err = (errJson as { error?: { [".tag"]?: string; path?: { [".tag"]?: string } } }).error;
  if (!err) return false;
  if (err[".tag"] === "path" && err.path?.[".tag"] === "conflict") return true;
  return err[".tag"] === "path_conflict";
}

function isDropboxPayloadTooLarge(status: number, errJson: unknown): boolean {
  if (status === 413) return true;
  if (!errJson || typeof errJson !== "object") return false;
  const summary = (errJson as { error_summary?: string }).error_summary;
  if (typeof summary === "string" && summary.includes("payload_too_large")) return true;
  const err = (errJson as { error?: { [".tag"]?: string } }).error;
  return err?.[".tag"] === "payload_too_large";
}

function parseDropboxRetryAfterSeconds(retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds);
  }
  return 60;
}

async function readErrorResponse(res: Response): Promise<{ errJson: unknown; errText: string }> {
  const errText = await res.text();
  let errJson: unknown;
  try {
    errJson = JSON.parse(errText);
  } catch {
    errJson = errText;
  }
  return { errJson, errText };
}

type UploadContext = {
  token: string;
  safePath: string;
  mode: "add" | "overwrite";
  logContext: Record<string, unknown>;
  onUnauthorized?: () => Promise<string | null>;
  didForceRefresh: boolean;
};

async function handleUploadError(
  res: Response,
  ctx: UploadContext & { pathConflictRetriedWithOverwrite: boolean }
): Promise<
  | { action: "ok"; data: { path_display?: string } }
  | { action: "retry"; mode?: "add" | "overwrite"; token?: string; pathConflictOverwrite?: boolean }
  | { action: "fail"; reason: string; status: number }
  | { action: "rate_limit"; retryAfterSeconds: number }
  | { action: "session_fallback" }
> {
  const { errJson, errText } = await readErrorResponse(res);
  const parsed = parseDropboxError(errJson, errText);
  const requestId = res.headers.get("x-dropbox-request-id");
  const retryAfter = res.headers.get("retry-after");

  console.error("[Dropbox upload] failed", {
    ...ctx.logContext,
    status: res.status,
    requestId,
    dropboxErrorSummary: parsed.errorSummary,
    dropboxErrorTag: parsed.errorTag,
    mode: ctx.mode,
    pathPreview: ctx.safePath.slice(0, 200),
  });

  if (isDropboxPayloadTooLarge(res.status, errJson)) {
    return { action: "session_fallback" };
  }

  if (
    !ctx.pathConflictRetriedWithOverwrite &&
    ctx.mode === "add" &&
    isDropboxPathConflict(res.status, errJson)
  ) {
    return { action: "retry", mode: "overwrite", pathConflictOverwrite: true };
  }

  if (res.status === 429) {
    return { action: "rate_limit", retryAfterSeconds: parseDropboxRetryAfterSeconds(retryAfter) };
  }

  if (res.status === 401 && ctx.onUnauthorized && !ctx.didForceRefresh) {
    const refreshed = await ctx.onUnauthorized();
    if (refreshed) {
      return { action: "retry", token: refreshed };
    }
  }

  if (!isRetryableHttpStatus(res.status)) {
    return { action: "fail", reason: failureReason(errJson, errText, res.status), status: res.status };
  }

  return { action: "fail", reason: failureReason(errJson, errText, res.status), status: res.status };
}

async function uploadViaSession(
  token: string,
  safePath: string,
  body: Buffer,
  mode: "add" | "overwrite",
  logContext: Record<string, unknown>,
  onUnauthorized?: () => Promise<string | null>
): Promise<DropboxUploadResult> {
  let activeToken = token;
  let didForceRefresh = false;
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < body.byteLength; offset += DROPBOX_SESSION_CHUNK_BYTES) {
    chunks.push(body.subarray(offset, Math.min(offset + DROPBOX_SESSION_CHUNK_BYTES, body.byteLength)));
  }
  if (chunks.length === 0) {
    chunks.push(Buffer.alloc(0));
  }

  jobLogSession("start", { ...logContext, bytes: body.byteLength, chunks: chunks.length });

  let sessionId: string;
  let uploadedOffset = 0;

  const startRes = await fetch(`${DROPBOX_CONTENT}/files/upload_session/start`, {
    method: "POST",
    headers: {
      Authorization: toLatin1Header(`Bearer ${activeToken}`),
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": toLatin1Header(JSON.stringify({ close: false })),
    },
    body: new Uint8Array(chunks[0]),
  });

  if (!startRes.ok) {
    const handled = await handleUploadError(startRes, {
      token: activeToken,
      safePath,
      mode,
      logContext,
      onUnauthorized,
      didForceRefresh,
      pathConflictRetriedWithOverwrite: false,
    });
    if (handled.action === "rate_limit") {
      throw new DropboxRateLimitError(handled.retryAfterSeconds);
    }
    if (handled.action === "retry" && handled.token) {
      return uploadViaSession(handled.token, safePath, body, mode, logContext, onUnauthorized);
    }
    return {
      ok: false,
      reason: handled.action === "fail" ? handled.reason : "upload_session/start failed",
      status: startRes.status,
    };
  }

  const startData = (await startRes.json()) as { session_id: string };
  sessionId = startData.session_id;
  uploadedOffset = chunks[0].byteLength;

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const appendRes = await fetch(`${DROPBOX_CONTENT}/files/upload_session/append_v2`, {
      method: "POST",
      headers: {
        Authorization: toLatin1Header(`Bearer ${activeToken}`),
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": toLatin1Header(
          JSON.stringify({
            cursor: { session_id: sessionId, offset: uploadedOffset },
            close: false,
          })
        ),
      },
      body: new Uint8Array(chunk),
    });

    if (!appendRes.ok) {
      const { errJson, errText } = await readErrorResponse(appendRes);
      if (appendRes.status === 401 && onUnauthorized && !didForceRefresh) {
        didForceRefresh = true;
        const refreshed = await onUnauthorized();
        if (refreshed) {
          activeToken = refreshed;
          return uploadViaSession(activeToken, safePath, body, mode, logContext, onUnauthorized);
        }
      }
      if (appendRes.status === 429) {
        throw new DropboxRateLimitError(
          parseDropboxRetryAfterSeconds(appendRes.headers.get("retry-after"))
        );
      }
      return {
        ok: false,
        reason: failureReason(errJson, errText, appendRes.status),
        status: appendRes.status,
      };
    }
    uploadedOffset += chunk.byteLength;
  }

  const finishRes = await fetch(`${DROPBOX_CONTENT}/files/upload_session/finish`, {
    method: "POST",
    headers: {
      Authorization: toLatin1Header(`Bearer ${activeToken}`),
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": toLatin1Header(
        JSON.stringify({
          cursor: { session_id: sessionId, offset: uploadedOffset },
          commit: { path: safePath, mode: dropboxWriteMode(mode) },
        })
      ),
    },
  });

  if (!finishRes.ok) {
    const { errJson, errText } = await readErrorResponse(finishRes);
    if (finishRes.status === 401 && onUnauthorized && !didForceRefresh) {
      const refreshed = await onUnauthorized();
      if (refreshed) {
        return uploadViaSession(refreshed, safePath, body, mode, logContext, onUnauthorized);
      }
    }
    if (finishRes.status === 429) {
      throw new DropboxRateLimitError(
        parseDropboxRetryAfterSeconds(finishRes.headers.get("retry-after"))
      );
    }
    return {
      ok: false,
      reason: failureReason(errJson, errText, finishRes.status),
      status: finishRes.status,
    };
  }

  const finishData = (await finishRes.json()) as { path_display?: string };
  jobLogSession("finish", { ...logContext, path: finishData.path_display ?? safePath });
  return { ok: true, path_display: finishData.path_display ?? safePath };
}

function jobLogSession(phase: string, fields: Record<string, unknown>): void {
  console.log(`[Dropbox upload session] ${phase}`, fields);
}

/** Upload a file to Dropbox (simple API under 150 MB, session API for larger videos). */
export async function uploadFileToDropbox(
  accessToken: string,
  path: string,
  body: Buffer,
  options: DropboxUploadOptions = {}
): Promise<DropboxUploadResult> {
  const fullPath = ensureDropboxPath(path.replace(/\/$/, ""));
  const safePath = sanitizePathForHeader(fullPath);
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_HTTP_MAX_RETRIES);
  let mode = options.mode ?? "add";
  const logContext = options.logContext ?? {};
  let token = accessToken;
  let didForceRefresh = false;
  let pathConflictRetriedWithOverwrite = false;
  let triedSession = false;

  if (body.byteLength > DROPBOX_SIMPLE_UPLOAD_MAX_BYTES) {
    triedSession = true;
    return uploadViaSession(token, safePath, body, mode, logContext, options.onUnauthorized);
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${DROPBOX_CONTENT}/files/upload`, {
        method: "POST",
        headers: {
          Authorization: toLatin1Header(`Bearer ${token}`),
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": toLatin1Header(
            JSON.stringify({
              path: safePath,
              mode: dropboxWriteMode(mode),
            })
          ),
        },
        body: new Uint8Array(body),
      });
    } catch (err) {
      if (attempt === maxRetries) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
      await sleep(backoffMs(attempt, null));
      continue;
    }

    if (res.ok) {
      const data = (await res.json()) as { path_display?: string };
      return { ok: true, path_display: data.path_display ?? safePath };
    }

    const handled = await handleUploadError(res, {
      token,
      safePath,
      mode,
      logContext,
      onUnauthorized: options.onUnauthorized,
      didForceRefresh,
      pathConflictRetriedWithOverwrite,
    });

    if (handled.action === "ok") {
      return { ok: true, path_display: handled.data.path_display ?? safePath };
    }
    if (handled.action === "session_fallback" && !triedSession) {
      triedSession = true;
      jobLogSession("fallback", { ...logContext, bytes: body.byteLength, reason: "payload_too_large" });
      return uploadViaSession(token, safePath, body, mode, logContext, options.onUnauthorized);
    }
    if (handled.action === "rate_limit") {
      if (attempt === maxRetries) {
        throw new DropboxRateLimitError(handled.retryAfterSeconds);
      }
      const waitMs = handled.retryAfterSeconds * 1000;
      if (waitMs > DROPBOX_MAX_INLINE_BACKOFF_MS) {
        throw new DropboxRateLimitError(handled.retryAfterSeconds);
      }
      await sleep(waitMs);
      continue;
    }
    if (handled.action === "retry") {
      if (handled.token) {
        token = handled.token;
        didForceRefresh = true;
      }
      if (handled.mode) mode = handled.mode;
      if (handled.pathConflictOverwrite) pathConflictRetriedWithOverwrite = true;
      continue;
    }
    if (handled.action === "fail") {
      if (isRetryableHttpStatus(handled.status) && attempt < maxRetries) {
        await sleep(backoffMs(attempt, res.headers.get("retry-after")));
        continue;
      }
      return { ok: false, reason: handled.reason, status: handled.status };
    }
  }

  return { ok: false, reason: "upload failed after retries" };
}
