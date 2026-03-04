import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      googleAiStudioApiKey: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Return masked key for display (show only that it's set, or last 4 chars)
  const key = user.googleAiStudioApiKey;
  const masked = key
    ? key.length <= 4
      ? "••••"
      : "••••••••" + key.slice(-4)
    : null;

  return NextResponse.json({
    googleAiStudioApiKey: masked,
    hasGoogleAiStudioApiKey: !!key,
  });
}

export async function PATCH(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { googleAiStudioApiKey?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const value =
    body.googleAiStudioApiKey === null ||
    body.googleAiStudioApiKey === undefined
      ? null
      : typeof body.googleAiStudioApiKey === "string"
        ? body.googleAiStudioApiKey.trim() || null
        : null;

  await prisma.user.update({
    where: { id: userId },
    data: { googleAiStudioApiKey: value },
  });

  return NextResponse.json({ ok: true });
}
