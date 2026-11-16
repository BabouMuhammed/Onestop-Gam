-- Damage reports with a second-person approval before stock is written off.

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'DAMAGE';

-- CreateEnum
CREATE TYPE "DamageReason" AS ENUM ('BROKEN', 'EXPIRED', 'SPOILED', 'MISSING', 'OTHER');

-- AlterTable
ALTER TABLE "Division" ADD COLUMN "nextDamageNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StockMovement" ADD COLUMN "damageId" TEXT;

-- CreateTable
CREATE TABLE "DamageReport" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "reason" "DamageReason" NOT NULL,
    "note" TEXT NOT NULL,
    "reportedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DamageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamageDecision" (
    "id" TEXT NOT NULL,
    "damageId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "note" TEXT,
    "unitCost" DECIMAL(12,2),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DamageDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DamageReport_divisionId_number_key" ON "DamageReport"("divisionId", "number");
CREATE INDEX "DamageReport_divisionId_createdAt_idx" ON "DamageReport"("divisionId", "createdAt");
CREATE UNIQUE INDEX "DamageDecision_damageId_key" ON "DamageDecision"("damageId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_damageId_fkey" FOREIGN KEY ("damageId") REFERENCES "DamageReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DamageDecision" ADD CONSTRAINT "DamageDecision_damageId_fkey" FOREIGN KEY ("damageId") REFERENCES "DamageReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the Prisma schema cannot express.
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "DamageDecision" ADD CONSTRAINT "DamageDecision_cost_not_negative" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);
CREATE TRIGGER "DamageReport_append_only" BEFORE UPDATE OR DELETE ON "DamageReport"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "DamageDecision_append_only" BEFORE UPDATE OR DELETE ON "DamageDecision"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
