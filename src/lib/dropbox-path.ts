/** Normalize Dropbox paths for stable comparison (no trailing slash). */
export function normalizeDropboxPath(path: string | null | undefined): string | null {
  if (path == null) return null;
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

/** True when filePath is the source folder or a file/folder inside it. */
export function isUnderDropboxSourcePath(filePath: string, sourcePath: string): boolean {
  const root = normalizeDropboxPath(sourcePath);
  const file = normalizeDropboxPath(filePath);
  if (!root || !file) return false;
  return file === root || file.startsWith(`${root}/`);
}
