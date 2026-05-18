/**
 * Dropbox OAuth2 and API helpers.
 * Docs: https://www.dropbox.com/oauth-guide
 * Refresh token logic: we store expires_at and refresh proactively before expiry.
 */

import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import {
  backoffMs,
  DEFAULT_HTTP_MAX_RETRIES,
  isRetryableHttpStatus,
  sleep,
} from "@/lib/http-retry";

const DROPBOX_AUTH = "https://www.dropbox.com/oauth2/authorize";
const STATE_JWT_ALG = "HS256";
const STATE_EXP = "10m";

export async function createDropboxState(userId: string, returnTo?: string | null): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  return new SignJWT({ userId, returnTo: returnTo ?? undefined })
    .setProtectedHeader({ alg: STATE_JWT_ALG })
    .setExpirationTime(STATE_EXP)
    .sign(new TextEncoder().encode(secret));
}

export type DropboxStatePayload = { userId: string; returnTo?: string };

export async function verifyDropboxState(state: string): Promise<DropboxStatePayload> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  const { payload } = await jwtVerify(
    state,
    new TextEncoder().encode(secret),
    { algorithms: [STATE_JWT_ALG] }
  );
  const userId = payload.userId;
  if (typeof userId !== "string") throw new Error("Invalid state");
  const returnTo = typeof payload.returnTo === "string" ? payload.returnTo : undefined;
  return { userId, returnTo };
}
const DROPBOX_TOKEN = "https://api.dropbox.com/oauth2/token";
const DROPBOX_API = "https://api.dropboxapi.com/2";

export function getRedirectUri(): string {
  const host = process.env.HOSTNAME ?? "http://localhost:3000";
  return `${host.replace(/\/$/, "")}/api/dropbox/callback`;
}

export function getAuthUrl(state: string): string {
  const clientId = process.env.DROPBOX_APP_KEY;
  if (!clientId) throw new Error("DROPBOX_APP_KEY not set");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    state,
    token_access_type: "offline",
  });
  return `${DROPBOX_AUTH}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  account_id?: string;
  expires_in?: number;
}> {
  const clientId = process.env.DROPBOX_APP_KEY;
  const clientSecret = process.env.DROPBOX_APP_SECRET;
  if (!clientId || !clientSecret) throw new Error("Dropbox app not configured");

  const res = await fetch(DROPBOX_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in?: number;
}> {
  const clientId = process.env.DROPBOX_APP_KEY;
  const clientSecret = process.env.DROPBOX_APP_SECRET;
  if (!clientId || !clientSecret) throw new Error("Dropbox app not configured");

  const res = await fetch(DROPBOX_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox token refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

/** Buffer before expiry (5 min) to refresh early */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
/** Default expiry when Dropbox doesn't return expires_in (e.g. 4h) */
const DEFAULT_EXPIRES_IN_SEC = 14400;

/**
 * Returns a valid Dropbox access token for the user, refreshing automatically
 * when the token is expired or within the refresh buffer. Returns null if user
 * is not connected to Dropbox or refresh fails (e.g. revoked).
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  return getValidAccessTokenWithOptions(userId, {});
}

export async function getValidAccessTokenWithOptions(
  userId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<string | null> {
  const { forceRefresh = false } = options;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      dropboxAccessToken: true,
      dropboxRefreshToken: true,
      dropboxTokenExpiresAt: true,
    },
  });
  if (!user?.dropboxAccessToken) return null;

  const now = Date.now();
  const expiresAt = user.dropboxTokenExpiresAt?.getTime() ?? 0;
  const shouldRefresh =
    !!user.dropboxRefreshToken &&
    (forceRefresh || expiresAt === 0 || expiresAt <= now + REFRESH_BUFFER_MS);

  if (shouldRefresh) {
    try {
      const refreshed = await refreshAccessToken(user.dropboxRefreshToken!);
      const newToken = refreshed.access_token;
      const expiresInSec = refreshed.expires_in ?? DEFAULT_EXPIRES_IN_SEC;
      const newExpiresAt = new Date(now + expiresInSec * 1000);
      await prisma.user.update({
        where: { id: userId },
        data: {
          dropboxAccessToken: newToken,
          dropboxTokenExpiresAt: newExpiresAt,
        },
      });
      return newToken;
    } catch (err) {
      console.error("[Dropbox token] refresh failed", {
        userId,
        forceRefresh,
        hasRefreshToken: !!user.dropboxRefreshToken,
        expiresAt: user.dropboxTokenExpiresAt?.toISOString() ?? null,
        error: err instanceof Error ? err.message : String(err),
      });
      const tokenExpired = expiresAt !== 0 && expiresAt <= now;
      if (forceRefresh || tokenExpired) return null;
      return user.dropboxAccessToken;
    }
  }

  return user.dropboxAccessToken;
}

export async function dropboxFetch(
  accessToken: string,
  path: string,
  options: Omit<RequestInit, "body"> & { body?: Record<string, unknown> } = {}
): Promise<Response> {
  const { body, ...rest } = options;
  const url = path.startsWith("http") ? path : `${DROPBOX_API}${path}`;
  const headers: HeadersInit = {
    Authorization: `Bearer ${accessToken}`,
    ...(rest.headers as HeadersInit),
  };
  if (body !== undefined && body !== null) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return fetch(url, {
    ...rest,
    headers,
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });
}

type ListFolderEntry = {
  name: string;
  ".tag": string;
  path_display?: string;
  path_lower?: string;
  id?: string; // file id for download by id (avoids path encoding)
};

/** List folder contents. path: "" for root, or "/Folder/Subfolder" */
export async function listFolder(
  accessToken: string,
  path: string
): Promise<{ entries: ListFolderEntry[] }> {
  const res = await dropboxFetch(accessToken, "/files/list_folder", {
    method: "POST",
    body: { path: path || "", recursive: false, include_media_info: false },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { summary?: string } }).error?.summary ?? `list_folder ${res.status}`);
  }
  const data = await res.json();
  return { entries: data.entries ?? [] };
}

export class DropboxListFolderResetError extends Error {
  constructor() {
    super("Dropbox list_folder cursor expired (reset)");
    this.name = "DropboxListFolderResetError";
  }
}

/** List folder and return cursor for later list_folder/continue (used by webhook) */
export async function listFolderWithCursor(
  accessToken: string,
  path: string
): Promise<{ entries: ListFolderEntry[]; cursor: string; has_more: boolean }> {
  const res = await dropboxFetch(accessToken, "/files/list_folder", {
    method: "POST",
    body: { path: path || "", recursive: true, include_media_info: false },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { summary?: string } }).error?.summary ?? `list_folder ${res.status}`);
  }
  const data = await res.json();
  return {
    entries: data.entries ?? [],
    cursor: data.cursor ?? "",
    has_more: data.has_more ?? false,
  };
}

/** Continue listing with cursor (returns delta since last cursor) */
export async function listFolderContinue(
  accessToken: string,
  cursor: string
): Promise<{ entries: ListFolderEntry[]; cursor: string; has_more: boolean }> {
  const res = await dropboxFetch(accessToken, "/files/list_folder/continue", {
    method: "POST",
    body: { cursor },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const tag = (err as { error?: { ".tag"?: string } }).error?.[".tag"];
    if (tag === "reset") throw new DropboxListFolderResetError();
    throw new Error((err as { error?: { summary?: string } }).error?.summary ?? `list_folder/continue ${res.status}`);
  }
  const data = await res.json();
  return {
    entries: data.entries ?? [],
    cursor: data.cursor ?? cursor,
    has_more: data.has_more ?? false,
  };
}

/** Create a folder. path: full path e.g. "/New Folder" or "/Parent/New Folder" */
export async function createFolder(
  accessToken: string,
  path: string
): Promise<{ metadata: { name: string; path_display: string; path_lower: string } }> {
  const res = await dropboxFetch(accessToken, "/files/create_folder_v2", {
    method: "POST",
    body: { path: path.replace(/\/$/, ""), autorename: true },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const tag = (err as { error?: { ".tag"?: string; path?: string } }).error?.[".tag"];
    const pathErr = (err as { error?: { path?: { ".tag"?: string } } }).error?.path;
    if (tag === "path" && pathErr?.[".tag"] === "conflict") {
      throw new Error("A file or folder with that name already exists");
    }
    throw new Error((err as { error?: { error_summary?: string } }).error?.error_summary ?? `create_folder ${res.status}`);
  }
  return res.json();
}

const DROPBOX_CONTENT = "https://content.dropboxapi.com/2";

/** HTTP headers must be Latin-1 (ByteString). Force string to Latin-1 so fetch() never throws. */
function toLatin1Header(s: string): string {
  return Array.from(s, (ch) => {
    const code = ch.codePointAt(0)!;
    return code <= 255 ? ch : "?";
  }).join("");
}

/** Normalize path: Unicode spaces (e.g. U+202F) → ASCII space; then ensure Latin-1 for header. */
function sanitizePathForHeader(path: string): string {
  const normalized = path.replace(/\u202F/g, " ").replace(/\s/g, " ");
  return toLatin1Header(normalized);
}

/** pathOrId: file path (e.g. "/Folder/file.jpg") or file id (e.g. "id:xxxxx"). Using id avoids path encoding issues. */
export async function downloadFile(
  accessToken: string,
  pathOrId: string,
  options: {
    maxRetries?: number;
    onUnauthorized?: () => Promise<string | null>;
    logContext?: Record<string, unknown>;
  } = {}
): Promise<Buffer | null> {
  const useId = pathOrId.startsWith("id:");
  const arg = useId ? pathOrId : sanitizePathForHeader(pathOrId);
  const apiArg = JSON.stringify({ path: arg });
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_HTTP_MAX_RETRIES);
  const logContext = {
    ...options.logContext,
    pathOrId: useId ? pathOrId : pathOrId.slice(0, 80) + (pathOrId.length > 80 ? "…" : ""),
    useId,
  };
  let token = accessToken;
  let didForceRefresh = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${DROPBOX_CONTENT}/files/download`, {
        method: "POST",
        headers: {
          Authorization: toLatin1Header(`Bearer ${token}`),
          "Dropbox-API-Arg": toLatin1Header(apiArg),
        },
      });

      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }

      const errText = await res.text();
      let errJson: unknown;
      try {
        errJson = JSON.parse(errText);
      } catch {
        errJson = errText;
      }
      const requestId = res.headers.get("x-dropbox-request-id");
      const retryAfter = res.headers.get("retry-after");
      const isRetryable = isRetryableHttpStatus(res.status);

      console.error("[Dropbox download] failed", {
        ...logContext,
        status: res.status,
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        requestId,
        retryAfter,
        isRetryable,
        error: errJson,
      });

      if (res.status === 401 && options.onUnauthorized && !didForceRefresh) {
        didForceRefresh = true;
        const refreshed = await options.onUnauthorized();
        if (refreshed) {
          console.log("[Dropbox download] token refresh OK — retrying", {
            ...logContext,
            attempt: attempt + 1,
          });
          token = refreshed;
          continue;
        }
        return null;
      }

      if (!isRetryable || attempt === maxRetries) {
        return null;
      }

      const waitMs = backoffMs(attempt, retryAfter);
      console.error("[Dropbox download] backing off before retry", {
        ...logContext,
        nextAttempt: attempt + 2,
        waitMs,
      });
      await sleep(waitMs);
    } catch (err) {
      const isLast = attempt === maxRetries;
      console.error("[Dropbox download] network error", {
        ...logContext,
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        error: err instanceof Error ? err.message : String(err),
        isLast,
      });
      if (isLast) return null;
      await sleep(backoffMs(attempt, null));
    }
  }

  return null;
}

/** pathOrId: file path or "id:xxxxx". Using id avoids path encoding issues. */
export async function getTemporaryLink(
  accessToken: string,
  pathOrId: string
): Promise<{ link: string } | null> {
  const arg = pathOrId.startsWith("id:") ? pathOrId : sanitizePathForHeader(pathOrId);
  const res = await dropboxFetch(accessToken, "/files/get_temporary_link", {
    method: "POST",
    body: { path: arg },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { link?: string };
  return data.link != null ? { link: data.link } : null;
}

/** Headers Dropbox sends that help support/debug (never log tokens). */
function dropboxResponseHeadersForLog(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (
      k.startsWith("x-dropbox") ||
      k === "retry-after" ||
      k === "www-authenticate" ||
      k === "content-type" ||
      k === "content-length"
    ) {
      out[key] = value;
    }
  });
  return out;
}

export { uploadFileToDropbox, type DropboxUploadResult } from "@/lib/dropbox-upload";
