import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { USER_ROLE } from "@/lib/constants/user-role";
import { retryDropboxUploadForJob } from "@/lib/retry-dropbox-upload";

export const maxDuration = 120;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== USER_ROLE.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await params;
  const result = await retryDropboxUploadForJob(jobId, {
    userId: user.id,
    isAdmin: true,
  });

  if (result.ok) {
    return NextResponse.json({ ok: true, jobId, outputDropboxPath: result.outputDropboxPath });
  }

  return NextResponse.json(
    { ok: false, error: result.error, retryAfterSeconds: result.retryAfterSeconds },
    { status: result.status }
  );
}
