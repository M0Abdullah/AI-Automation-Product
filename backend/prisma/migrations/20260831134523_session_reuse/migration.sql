-- AlterTable
ALTER TABLE "run_secrets" ADD COLUMN "sessionCipher" TEXT;
ALTER TABLE "run_secrets" ADD COLUMN "sessionCreatedAt" DATETIME;

-- AlterTable
ALTER TABLE "runs" ADD COLUMN "loginEmailField" TEXT;
ALTER TABLE "runs" ADD COLUMN "loginPassField" TEXT;
ALTER TABLE "runs" ADD COLUMN "loginSubmit" TEXT;
ALTER TABLE "runs" ADD COLUMN "loginUrl" TEXT;
ALTER TABLE "runs" ADD COLUMN "sessionEvidence" TEXT;
