import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  await destroySession();
  const url = request.nextUrl.clone();
  url.pathname = "/";
  return NextResponse.redirect(url);
}
