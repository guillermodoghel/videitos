import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { CREDITS_PER_DOLLAR, MIN_PURCHASE_USD, MAX_PURCHASE_USD } from "@/lib/stripe";

/**
 * GET /api/credits/auto-recharge
 * Returns current auto-recharge settings for the authenticated user.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      autoRechargeEnabled: true,
      autoRechargeThreshold: true,
      autoRechargeAmount: true,
      stripeDefaultPaymentMethodId: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    enabled: user.autoRechargeEnabled,
    threshold: user.autoRechargeThreshold != null ? Number(user.autoRechargeThreshold) : null,
    amount: user.autoRechargeAmount != null ? Number(user.autoRechargeAmount) : null,
    hasPaymentMethod: !!user.stripeDefaultPaymentMethodId,
  });
}

/**
 * PUT /api/credits/auto-recharge
 * Body: { enabled: boolean, threshold?: number (credits), amount?: number (credits) }
 */
export async function PUT(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { enabled?: boolean; threshold?: number; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
  }

  if (body.enabled) {
    const threshold = body.threshold;
    const amount = body.amount;

    if (typeof threshold !== "number" || threshold < 1) {
      return NextResponse.json(
        { error: "threshold must be a positive number of credits" },
        { status: 400 }
      );
    }

    const amountUsd = (typeof amount === "number" ? amount : 0) / CREDITS_PER_DOLLAR;
    if (
      typeof amount !== "number" ||
      amountUsd < MIN_PURCHASE_USD ||
      amountUsd > MAX_PURCHASE_USD
    ) {
      return NextResponse.json(
        { error: `Recharge amount must be between $${MIN_PURCHASE_USD} and $${MAX_PURCHASE_USD}` },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        autoRechargeEnabled: true,
        autoRechargeThreshold: new Prisma.Decimal(threshold),
        autoRechargeAmount: new Prisma.Decimal(amount),
      },
    });
  } else {
    await prisma.user.update({
      where: { id: userId },
      data: { autoRechargeEnabled: false },
    });
  }

  return NextResponse.json({ ok: true });
}
