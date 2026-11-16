-- Till sessions: open with a float, sell, count the cash at close.

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openingFloat" DECIMAL(14,2) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashShiftClose" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "expectedCash" DECIMAL(14,2) NOT NULL,
    "countedCash" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "closedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashShiftClose_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "shiftId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "shiftId" TEXT;

-- CreateIndex
CREATE INDEX "CashShift_divisionId_openedAt_idx" ON "CashShift"("divisionId", "openedAt");
CREATE INDEX "CashShift_userId_divisionId_idx" ON "CashShift"("userId", "divisionId");
CREATE UNIQUE INDEX "CashShiftClose_shiftId_key" ON "CashShiftClose"("shiftId");
CREATE INDEX "Payment_shiftId_idx" ON "Payment"("shiftId");

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashShiftClose" ADD CONSTRAINT "CashShiftClose_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rules the Prisma schema cannot express.
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_float_not_negative" CHECK ("openingFloat" >= 0);
ALTER TABLE "CashShiftClose" ADD CONSTRAINT "CashShiftClose_counted_not_negative" CHECK ("countedCash" >= 0);
ALTER TABLE "CashShiftClose" ADD CONSTRAINT "CashShiftClose_difference_adds_up" CHECK ("difference" = "countedCash" - "expectedCash");
CREATE TRIGGER "CashShift_append_only" BEFORE UPDATE OR DELETE ON "CashShift"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "CashShiftClose_append_only" BEFORE UPDATE OR DELETE ON "CashShiftClose"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
