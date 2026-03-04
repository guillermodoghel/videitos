import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getAuthUrl, createDropboxState } from "@/lib/dropbox";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.redirect(new URL("/", process.env.HOSTNAME ?? "http://localhost:3000"));
  }
  const state = await createDropboxState(userId);
  const url = getAuthUrl(state);
  return NextResponse.redirect(url);
}
