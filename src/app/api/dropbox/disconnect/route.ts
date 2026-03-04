import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      dropboxAccessToken: null,
      dropboxRefreshToken: null,
      dropboxAccountId: null,
    },
  });
  return NextResponse.json({ ok: true });
}
