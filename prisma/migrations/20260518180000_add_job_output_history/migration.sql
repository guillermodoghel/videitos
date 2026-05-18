-- CreateTable
CREATE TABLE "videitos"."JobOutput" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "outputDropboxPath" TEXT,
    "outputVideoS3Key" TEXT,
    "providerOperationId" TEXT,
    "preGenImageKey" TEXT,
    "apiCost" DECIMAL(14,4),
    "creditCost" DECIMAL(14,4),
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobOutput_jobId_idx" ON "videitos"."JobOutput"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOutput_jobId_version_key" ON "videitos"."JobOutput"("jobId", "version");

-- AddForeignKey
ALTER TABLE "videitos"."JobOutput" ADD CONSTRAINT "JobOutput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "videitos"."Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
