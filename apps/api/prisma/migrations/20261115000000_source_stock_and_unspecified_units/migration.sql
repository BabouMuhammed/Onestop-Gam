ALTER TYPE "Unit" ADD VALUE 'UNSPECIFIED';
ALTER TABLE "Product" ADD COLUMN "openingSourceKey" TEXT,
  ADD COLUMN "openingSource" JSONB,
  ADD COLUMN "requiresStockReview" BOOLEAN NOT NULL DEFAULT false;
DROP INDEX "Product_divisionId_name_key";
CREATE INDEX "Product_divisionId_name_idx" ON "Product"("divisionId", "name");
-- Manual products retain their existing exact-name uniqueness. Source records use
-- independent provenance identities and can share an unchanged original name.
CREATE UNIQUE INDEX "Product_manual_name_key" ON "Product"("divisionId", "name") WHERE "openingSourceKey" IS NULL;
CREATE UNIQUE INDEX "Product_divisionId_openingSourceKey_key" ON "Product"("divisionId", "openingSourceKey");
