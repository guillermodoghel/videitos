import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { resumeInsufficientCreditsJobs } from "@/lib/resume-insufficient-credits-jobs";
import { USER_ROLE } from "@/lib/constants/user-role";
import { CREDIT_KIND } from "@/lib/constants/credit-transaction-kind";

/**
 * POST /api/admin/users/[id]/credits
 * Admin only. Grant credits to a user. Body: { amount: number } (positive).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== USER_ROLE.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: targetUserId } = await params;
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: { amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const amount = typeof body.amount === "number" ? body.amount : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: { creditBalance: { increment: new Prisma.Decimal(amount) } },
    });
    await tx.creditTransaction.create({
      data: {
        userId: targetUserId,
        amount: new Prisma.Decimal(amount),
        kind: CREDIT_KIND.GRANT,
        description: "Admin grant",
      },
    });
  });

  const resumed = await resumeInsufficientCreditsJobs(targetUserId);
  if (resumed > 0) {
    console.log("[admin/credits] Re-queued %s job(s) after grant (user=%s)", resumed, targetUserId);
  }

  const updated = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { creditBalance: true },
  });
  return NextResponse.json({
    ok: true,
    balance: Number(updated?.creditBalance ?? 0),
  });
}
