-- AlterTable User: Dropbox OAuth
ALTER TABLE "videitos"."User" ADD COLUMN "dropboxAccessToken" TEXT;
ALTER TABLE "videitos"."User" ADD COLUMN "dropboxRefreshToken" TEXT;
ALTER TABLE "videitos"."User" ADD COLUMN "dropboxAccountId" TEXT;

-- AlterTable Template: Dropbox source/destination
ALTER TABLE "videitos"."Template" ADD COLUMN "dropboxSourcePath" TEXT;
ALTER TABLE "videitos"."Template" ADD COLUMN "dropboxDestinationPath" TEXT;
