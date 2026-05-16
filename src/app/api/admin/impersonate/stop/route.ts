import { NextResponse } from "next/server";
import { stopImpersonation } from "@/lib/auth";

/**
 * POST /api/admin/impersonate/stop
 * End impersonation and restore the admin session.
 */
export async function POST() {
  const stopped = await stopImpersonation();
  if (!stopped) {
    return NextResponse.json(
      { error: "Not impersonating" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
