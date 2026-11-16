-- Price changes by managers wait for the CEO's approval.

-- CreateTable
CREATE TABLE "PriceChangeRequest" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "oldPrice" DECIMAL(12,2) NOT NULL,
    "newPrice" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceChangeDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceChangeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceChangeRequest_divisionId_createdAt_idx" ON "PriceChangeRequest"("divisionId", "createdAt");
CREATE INDEX "PriceChangeRequest_productId_createdAt_idx" ON "PriceChangeRequest"("productId", "createdAt");
CREATE UNIQUE INDEX "PriceChangeDecision_requestId_key" ON "PriceChangeDecision"("requestId");

-- AddForeignKey
ALTER TABLE "PriceChangeRequest" ADD CONSTRAINT "PriceChangeRequest_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceChangeRequest" ADD CONSTRAINT "PriceChangeRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceChangeDecision" ADD CONSTRAINT "PriceChangeDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PriceChangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the Prisma schema cannot express.
ALTER TABLE "PriceChangeRequest" ADD CONSTRAINT "PriceChangeRequest_prices_valid" CHECK ("oldPrice" >= 0 AND "newPrice" >= 0 AND "newPrice" <> "oldPrice");
CREATE TRIGGER "PriceChangeRequest_append_only" BEFORE UPDATE OR DELETE ON "PriceChangeRequest"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "PriceChangeDecision_append_only" BEFORE UPDATE OR DELETE ON "PriceChangeDecision"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
