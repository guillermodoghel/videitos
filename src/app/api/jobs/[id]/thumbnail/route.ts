import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureJobSourceThumbnail } from "@/lib/ensure-job-source-thumbnail";
import { verifyJobThumbnailToken } from "@/lib/job-thumbnail-token";
import { USER_ROLE } from "@/lib/constants/user-role";

/** Browser + Vercel Image CDN cache (immutable blob per job). */
const THUMBNAIL_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * GET /api/jobs/[id]/thumbnail?t=…
 * Serves a cached source thumbnail (Dropbox downloaded once to S3).
 * Auth: session cookie or signed token (for next/image / CDN fetch).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("t");

  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      sourceThumbnailKey: true,
      dropboxSourceFilePath: true,
      dropboxSourceFileId: true,
    },
  });

  if (!job) {
    return new NextResponse(null, { status: 404 });
  }

  const sessionOk =
    !!sessionUser &&
    (sessionUser.role === USER_ROLE.ADMIN || job.userId === sessionUser.id);
  const tokenOk = verifyJobThumbnailToken(id, token);

  if (!sessionOk && !tokenOk) {
    return new NextResponse(null, { status: 401 });
  }

  const cached = await ensureJobSourceThumbnail(job);
  if (!cached) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(cached.buffer), {
    status: 200,
    headers: {
      "Content-Type": cached.contentType,
      "Cache-Control": `public, max-age=${THUMBNAIL_CACHE_MAX_AGE_SECONDS}, immutable`,
    },
  });
}
