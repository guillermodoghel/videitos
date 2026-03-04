import { NextResponse } from "next/server";
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
      dropboxAccessToken: true,
      dropboxAccountId: true,
    },
  });
  return NextResponse.json({
    connected: !!user?.dropboxAccessToken,
    accountId: user?.dropboxAccountId ?? null,
  });
}
