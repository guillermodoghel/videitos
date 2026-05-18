/** Normalize Dropbox paths for stable comparison (no trailing slash). */
export function normalizeDropboxPath(path: string | null | undefined): string | null {
  if (path == null) return null;
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

/** Ensure a Dropbox API path starts with `/` and has no duplicate slashes. */
export function ensureDropboxPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/{2,}/g, "/");
}

/** True when filePath is the source folder or a file/folder inside it. */
export function isUnderDropboxSourcePath(filePath: string, sourcePath: string): boolean {
  const root = normalizeDropboxPath(sourcePath);
  const file = normalizeDropboxPath(filePath);
  if (!root || !file) return false;
  return file === root || file.startsWith(`${root}/`);
}
