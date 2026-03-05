import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getAuthUrl, createDropboxState } from "@/lib/dropbox";

/** Allowed returnTo paths (must start with one of these to avoid open redirect). */
const ALLOWED_RETURN_PREFIXES = ["/dashboard/"];

function isValidReturnTo(returnTo: string | null): boolean {
  if (!returnTo || !returnTo.startsWith("/")) return false;
  return ALLOWED_RETURN_PREFIXES.some((p) => returnTo.startsWith(p));
}

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.redirect(new URL("/", process.env.HOSTNAME ?? "http://localhost:3000"));
  }
  const returnTo = request.nextUrl.searchParams.get("returnTo");
  const state = await createDropboxState(userId, isValidReturnTo(returnTo) ? returnTo : undefined);
  const url = getAuthUrl(state);
  return NextResponse.redirect(url);
}
