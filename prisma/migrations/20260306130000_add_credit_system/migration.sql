-- Credit system: user balance, job costs, transactions
ALTER TABLE "videitos"."User" ADD COLUMN IF NOT EXISTS "creditBalance" DECIMAL(14,4) NOT NULL DEFAULT 0;

ALTER TABLE "videitos"."Job" ADD COLUMN IF NOT EXISTS "apiCost" DECIMAL(14,4);
ALTER TABLE "videitos"."Job" ADD COLUMN IF NOT EXISTS "creditCost" DECIMAL(14,4);

CREATE TABLE IF NOT EXISTS "videitos"."CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "jobId" TEXT,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "videitos"."CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "videitos"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "videitos"."CreditTransaction" ADD CONSTRAINT "CreditTransaction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "videitos"."Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "CreditTransaction_userId_idx" ON "videitos"."CreditTransaction"("userId");
CREATE INDEX IF NOT EXISTS "CreditTransaction_jobId_idx" ON "videitos"."CreditTransaction"("jobId");
CREATE INDEX IF NOT EXISTS "CreditTransaction_createdAt_idx" ON "videitos"."CreditTransaction"("createdAt");
