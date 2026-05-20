import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { reuploadJobOutputToDropbox } from "@/lib/reupload-job-output-to-dropbox";
import { USER_ROLE } from "@/lib/constants/user-role";

export const maxDuration = 120;

/**
 * POST /api/jobs/[id]/reupload-dropbox
 * Re-upload a specific output take to Dropbox from stored video (S3 / Dropbox / Runway cache).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const version = typeof body.version === "number" ? body.version : Number(body.version);
  if (!Number.isFinite(version) || version < 1) {
    return NextResponse.json({ error: "version is required" }, { status: 400 });
  }

  const { id: jobId } = await params;
  const result = await reuploadJobOutputToDropbox(jobId, {
    userId: sessionUser.id,
    isAdmin: sessionUser.role === USER_ROLE.ADMIN,
    version: Math.floor(version),
  });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      jobId,
      version: result.version,
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
