import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getTemporaryLink } from "@/lib/dropbox";
import { jobDropboxSourcePathOrId } from "@/lib/job-dropbox-source";
import { USER_ROLE } from "@/lib/constants/user-role";

/** Browser cache duration for the thumbnail redirect (stable URL per job). */
const THUMBNAIL_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * GET /api/jobs/[id]/thumbnail
 * Redirects to a Dropbox temporary link for the job source image.
 * Cache-Control lets the browser cache the response (stable URL per job).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return new NextResponse(null, { status: 401 });
  }
  const isAdmin = sessionUser.role === USER_ROLE.ADMIN;

  const { id } = await params;
  const job = await prisma.job.findFirst({
    where: {
      id,
      ...(isAdmin ? {} : { userId: sessionUser.id }),
    },
    select: {
      userId: true,
      dropboxSourceFilePath: true,
      dropboxSourceFileId: true,
    },
  });

  if (!job) {
    return new NextResponse(null, { status: 404 });
  }

  const token = await getValidAccessToken(job.userId);
  if (!token) {
    return new NextResponse(null, { status: 404 });
  }

  const link = await getTemporaryLink(token, jobDropboxSourcePathOrId(job));
  if (!link?.link) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(link.link, {
    status: 302,
    headers: {
      "Cache-Control": `private, max-age=${THUMBNAIL_CACHE_MAX_AGE_SECONDS}`,
    },
  });
}
