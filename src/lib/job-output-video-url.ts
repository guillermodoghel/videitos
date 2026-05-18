import { getValidAccessToken, getTemporaryLink } from "@/lib/dropbox";
import { getPresignedUrl, isS3Key } from "@/lib/s3";

/** Resolve a playable URL for an archived or current job output. */
export async function resolveJobOutputVideoUrl(
  userId: string,
  output: {
    outputVideoS3Key?: string | null;
    outputDropboxPath?: string | null;
  }
): Promise<string | null> {
  const s3Key = output.outputVideoS3Key;
  if (s3Key && isS3Key(s3Key) && s3Key.startsWith(`${userId}/`)) {
    const url = await getPresignedUrl(s3Key);
    if (url) return url;
  }

  const dropboxPath = output.outputDropboxPath;
  if (dropboxPath) {
    const token = await getValidAccessToken(userId);
    if (token) {
      const link = await getTemporaryLink(token, dropboxPath);
      if (link) return link.link;
    }
  }

  return null;
}
