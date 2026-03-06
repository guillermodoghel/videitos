import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

/**
 * GET /api/credits/transactions
 * Returns current user's credit transactions (grants and job spends), with job summary when applicable.
 * Query: page (1-based), perPage.
 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  let perPage = parseInt(searchParams.get("perPage") ?? String(DEFAULT_PER_PAGE), 10) || DEFAULT_PER_PAGE;
  perPage = Math.min(MAX_PER_PAGE, Math.max(1, perPage));

  const [transactions, total] = await Promise.all([
    prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        job: {
          select: {
            id: true,
            status: true,
            template: { select: { name: true, model: true } },
            createdAt: true,
          },
        },
      },
    }),
    prisma.creditTransaction.count({ where: { userId } }),
  ]);

  const list = transactions.map((t) => ({
    id: t.id,
    amount: Number(t.amount),
    kind: t.kind,
    description: t.description,
    createdAt: t.createdAt.toISOString(),
    job: t.job
      ? {
          id: t.job.id,
          status: t.job.status,
          templateName: t.job.template.name,
          model: t.job.template.model,
          createdAt: t.job.createdAt.toISOString(),
        }
      : null,
  }));

  return NextResponse.json({ transactions: list, total, page, perPage });
}
