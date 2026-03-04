import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getPresignedUrl, isS3Key } from "@/lib/s3";

/**
 * GET ?key=userId/templateId/references/...
 * Returns 302 redirect to presigned URL for displaying the reference image.
 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key || !isS3Key(key)) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  // Ensure the key belongs to this user (path starts with userId/)
  if (!key.startsWith(userId + "/")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = await getPresignedUrl(key);
  if (!url) {
    return NextResponse.json({ error: "Failed to get URL" }, { status: 500 });
  }

  return NextResponse.redirect(url);
}
