-- CreateTable
CREATE TABLE "videitos"."Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dropboxSourceFilePath" TEXT NOT NULL,
    "veoOperationName" TEXT,
    "sentToVeoAt" TIMESTAMP(3),
    "outputDropboxPath" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "videitos"."Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "videitos"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "videitos"."Job" ADD CONSTRAINT "Job_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "videitos"."Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
