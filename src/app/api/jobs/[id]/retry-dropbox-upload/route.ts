import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { retryDropboxUploadForJob } from "@/lib/retry-dropbox-upload";
import { USER_ROLE } from "@/lib/constants/user-role";

export const maxDuration = 120;

/**
 * POST /api/jobs/[id]/retry-dropbox-upload
 * Re-upload stored Runway video to Dropbox (after rate limit or upload failure).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: jobId } = await params;
  const result = await retryDropboxUploadForJob(jobId, {
    userId: sessionUser.id,
    isAdmin: sessionUser.role === USER_ROLE.ADMIN,
  });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      jobId,
      outputDropboxPath: result.outputDropboxPath,
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: result.error,
      retryAfterSeconds: result.retryAfterSeconds,
    },
    { status: result.status }
  );
}
