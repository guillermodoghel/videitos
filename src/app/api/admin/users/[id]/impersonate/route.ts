import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSessionUser, startImpersonation } from "@/lib/auth";
import { USER_ROLE } from "@/lib/constants/user-role";

/**
 * POST /api/admin/users/[id]/impersonate
 * Admin only. Switch the current session to act as the target user.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminSessionUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: targetUserId } = await params;

  if (targetUserId === admin.id) {
    return NextResponse.json(
      { error: "Cannot impersonate yourself" },
      { status: 400 }
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, role: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (target.role === USER_ROLE.ADMIN) {
    return NextResponse.json(
      { error: "Cannot impersonate another admin" },
      { status: 400 }
    );
  }

  await startImpersonation(admin.id, targetUserId);

  return NextResponse.json({
    ok: true,
    user: { id: target.id, email: target.email },
  });
}
