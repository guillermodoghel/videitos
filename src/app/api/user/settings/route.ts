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
      runwayApiKey: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const mask = (key: string | null) =>
    key
      ? key.length <= 4
        ? "••••"
        : "••••••••" + key.slice(-4)
      : null;

  return NextResponse.json({
    googleAiStudioApiKey: mask(user.googleAiStudioApiKey),
    hasGoogleAiStudioApiKey: !!user.googleAiStudioApiKey,
    runwayApiKey: mask(user.runwayApiKey),
    hasRunwayApiKey: !!user.runwayApiKey,
  });
}

export async function PATCH(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { googleAiStudioApiKey?: string | null; runwayApiKey?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const trimOrNull = (v: unknown): string | null =>
    v === null || v === undefined
      ? null
      : typeof v === "string"
        ? v.trim() || null
        : null;

  const googleAiStudioApiKey = trimOrNull(body.googleAiStudioApiKey);
  const runwayApiKey = trimOrNull(body.runwayApiKey);

  const data: { googleAiStudioApiKey?: string | null; runwayApiKey?: string | null } = {};
  if (body.googleAiStudioApiKey !== undefined) data.googleAiStudioApiKey = googleAiStudioApiKey;
  if (body.runwayApiKey !== undefined) data.runwayApiKey = runwayApiKey;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true });
  }

  await prisma.user.update({
    where: { id: userId },
    data,
  });

  return NextResponse.json({ ok: true });
}
