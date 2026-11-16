-- Two-step sign-in (authenticator app codes) for CEO and Finance.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT,
ADD COLUMN "totpPendingSecret" TEXT,
ADD COLUMN "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN "totpLastStep" INTEGER;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "twoStepPending" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TwoStepRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoStepRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TwoStepRecoveryCode_userId_idx" ON "TwoStepRecoveryCode"("userId");

-- AddForeignKey
ALTER TABLE "TwoStepRecoveryCode" ADD CONSTRAINT "TwoStepRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
