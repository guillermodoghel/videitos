import { NextRequest, NextResponse } from "next/server";
import { verifyDropboxState, exchangeCodeForToken } from "@/lib/dropbox";
import { prisma } from "@/lib/prisma";

const HOST = process.env.HOSTNAME ?? "http://localhost:3000";
const base = HOST.replace(/\/$/, "");

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    const msg = searchParams.get("error_description") ?? error;
    return NextResponse.redirect(`${base}/dashboard/settings?dropbox_error=${encodeURIComponent(msg)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${base}/dashboard/settings?dropbox_error=${encodeURIComponent("Missing code or state")}`);
  }

  let payload: { userId: string; returnTo?: string };
  try {
    payload = await verifyDropboxState(state);
  } catch {
    return NextResponse.redirect(`${base}/dashboard/settings?dropbox_error=${encodeURIComponent("Invalid or expired state")}`);
  }

  const { userId, returnTo } = payload;

  const tokens = await exchangeCodeForToken(code);
  const expiresInSec = tokens.expires_in ?? 14400;
  const dropboxTokenExpiresAt = new Date(Date.now() + expiresInSec * 1000);
  await prisma.user.update({
    where: { id: userId },
    data: {
      dropboxAccessToken: tokens.access_token,
      dropboxRefreshToken: tokens.refresh_token ?? null,
      dropboxTokenExpiresAt,
      dropboxAccountId: tokens.account_id ?? null,
    },
  });

  const successRedirect =
    returnTo && returnTo.startsWith("/dashboard/") ? `${base}${returnTo}` : `${base}/dashboard/settings`;
  const sep = successRedirect.includes("?") ? "&" : "?";
  return NextResponse.redirect(`${successRedirect}${sep}dropbox=connected`);
}
