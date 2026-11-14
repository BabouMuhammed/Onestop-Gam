-- Suppliers and stock receiving, with cost price captured on receipt.

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'RECEIPT';
ALTER TYPE "MovementType" ADD VALUE 'RECEIPT_REVERSAL';

-- AlterTable
ALTER TABLE "Division" ADD COLUMN "nextReceiptNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD COLUMN "costPrice" DECIMAL(12,2);
ALTER TABLE "StockMovement" ADD COLUMN "receiptId" TEXT;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceipt" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "lineCost" DECIMAL(14,2) NOT NULL,
    "batchNumber" TEXT,
    "expiryDate" DATE,

    CONSTRAINT "StockReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceiptReversal" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReceiptReversal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_divisionId_name_key" ON "Supplier"("divisionId", "name");
CREATE UNIQUE INDEX "StockReceipt_divisionId_number_key" ON "StockReceipt"("divisionId", "number");
CREATE INDEX "StockReceipt_divisionId_receivedOn_idx" ON "StockReceipt"("divisionId", "receivedOn");
CREATE INDEX "StockReceipt_supplierId_idx" ON "StockReceipt"("supplierId");
CREATE INDEX "StockReceiptLine_receiptId_idx" ON "StockReceiptLine"("receiptId");
CREATE INDEX "StockReceiptLine_productId_idx" ON "StockReceiptLine"("productId");
CREATE UNIQUE INDEX "StockReceiptReversal_receiptId_key" ON "StockReceiptReversal"("receiptId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceiptReversal" ADD CONSTRAINT "StockReceiptReversal_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the Prisma schema cannot express.
ALTER TABLE "Product" ADD CONSTRAINT "Product_cost_not_negative" CHECK ("costPrice" IS NULL OR "costPrice" >= 0);
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_cost_not_negative" CHECK ("unitCost" >= 0 AND "lineCost" >= 0);
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_total_not_negative" CHECK ("totalCost" >= 0);

-- Posted receipts are never edited or deleted, only reversed.
CREATE TRIGGER "StockReceipt_append_only" BEFORE UPDATE OR DELETE ON "StockReceipt"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "StockReceiptLine_append_only" BEFORE UPDATE OR DELETE ON "StockReceiptLine"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "StockReceiptReversal_append_only" BEFORE UPDATE OR DELETE ON "StockReceiptReversal"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
