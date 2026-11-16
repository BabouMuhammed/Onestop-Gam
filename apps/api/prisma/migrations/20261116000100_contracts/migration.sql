-- Contracts with agreed items, orders, deliveries (which take stock) and collections.

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'CONTRACT_DELIVERY';
ALTER TYPE "MovementType" ADD VALUE 'CONTRACT_DELIVERY_REVERSAL';

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('FIXED_SUPPLY', 'ONGOING_SUPPLY', 'PROJECT');
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Division" ADD COLUMN "nextContractNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Division" ADD COLUMN "nextOrderNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Division" ADD COLUMN "nextDeliveryNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StockMovement" ADD COLUMN "deliveryId" TEXT;

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "ContractType" NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "siteAddress" TEXT,
    "notes" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractItem" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "agreedPrice" DECIMAL(12,2) NOT NULL,
    "agreedQuantity" DECIMAL(14,3),
    CONSTRAINT "ContractItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractOrder" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderedOn" DATE NOT NULL,
    "requiredBy" DATE,
    "reference" TEXT,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "contractItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "ContractOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractOrderCancellation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractOrderCancellation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractDelivery" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "deliveredOn" DATE NOT NULL,
    "receivedBy" TEXT,
    "note" TEXT,
    "value" DECIMAL(14,2) NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractDeliveryLine" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "ContractDeliveryLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractDeliveryReversal" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractDeliveryReversal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractPayment" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "receivedOn" DATE NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contract_divisionId_number_key" ON "Contract"("divisionId", "number");
CREATE INDEX "Contract_divisionId_status_idx" ON "Contract"("divisionId", "status");
CREATE INDEX "Contract_customerId_idx" ON "Contract"("customerId");
CREATE UNIQUE INDEX "ContractItem_contractId_productId_key" ON "ContractItem"("contractId", "productId");
CREATE INDEX "ContractOrder_contractId_idx" ON "ContractOrder"("contractId");
CREATE INDEX "ContractOrderLine_orderId_idx" ON "ContractOrderLine"("orderId");
CREATE UNIQUE INDEX "ContractOrderCancellation_orderId_key" ON "ContractOrderCancellation"("orderId");
CREATE UNIQUE INDEX "ContractDelivery_divisionId_number_key" ON "ContractDelivery"("divisionId", "number");
CREATE INDEX "ContractDelivery_contractId_idx" ON "ContractDelivery"("contractId");
CREATE INDEX "ContractDeliveryLine_deliveryId_idx" ON "ContractDeliveryLine"("deliveryId");
CREATE INDEX "ContractDeliveryLine_orderLineId_idx" ON "ContractDeliveryLine"("orderLineId");
CREATE UNIQUE INDEX "ContractDeliveryReversal_deliveryId_key" ON "ContractDeliveryReversal"("deliveryId");
CREATE INDEX "ContractPayment_contractId_idx" ON "ContractPayment"("contractId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "ContractDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractItem" ADD CONSTRAINT "ContractItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractItem" ADD CONSTRAINT "ContractItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractOrder" ADD CONSTRAINT "ContractOrder_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractOrderLine" ADD CONSTRAINT "ContractOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ContractOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractOrderLine" ADD CONSTRAINT "ContractOrderLine_contractItemId_fkey" FOREIGN KEY ("contractItemId") REFERENCES "ContractItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractOrderCancellation" ADD CONSTRAINT "ContractOrderCancellation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ContractOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractDelivery" ADD CONSTRAINT "ContractDelivery_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractDelivery" ADD CONSTRAINT "ContractDelivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ContractOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractDeliveryLine" ADD CONSTRAINT "ContractDeliveryLine_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "ContractDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractDeliveryLine" ADD CONSTRAINT "ContractDeliveryLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "ContractOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractDeliveryReversal" ADD CONSTRAINT "ContractDeliveryReversal_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "ContractDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractPayment" ADD CONSTRAINT "ContractPayment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the Prisma schema cannot express.
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dates_valid" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "ContractItem" ADD CONSTRAINT "ContractItem_amounts_valid" CHECK ("agreedPrice" >= 0 AND ("agreedQuantity" IS NULL OR "agreedQuantity" > 0));
ALTER TABLE "ContractOrderLine" ADD CONSTRAINT "ContractOrderLine_amounts_valid" CHECK ("quantity" > 0 AND "unitPrice" >= 0);
ALTER TABLE "ContractDeliveryLine" ADD CONSTRAINT "ContractDeliveryLine_amounts_valid" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "ContractDelivery" ADD CONSTRAINT "ContractDelivery_value_not_negative" CHECK ("value" >= 0);
ALTER TABLE "ContractPayment" ADD CONSTRAINT "ContractPayment_amount_positive" CHECK ("amount" > 0);

-- Agreed items, orders, deliveries and payments are never edited or deleted.
CREATE TRIGGER "ContractItem_append_only" BEFORE UPDATE OR DELETE ON "ContractItem" FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "ContractOrder_append_only" BEFORE UPDATE OR DELETE ON "ContractOrder" FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "ContractOrderLine_append_only" BEFORE UPDATE OR DELETE ON "ContractOrderLine" FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "ContractOrderCancellation_append_only" BEFORE UPDATE OR DELETE ON "ContractOrderCancellation" FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "ContractDelivery_append_only" BEFORE UPDATE OR DELETE ON "ContractDelivery" FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "ContractDeliveryLine_append_only" BEFORE UPDATE OR DELETE ON "ContractDeliveryLine" FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "ContractDeliveryReversal_append_only" BEFORE UPDATE OR DELETE ON "ContractDeliveryReversal" FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER "ContractPayment_append_only" BEFORE UPDATE OR DELETE ON "ContractPayment" FOR EACH ROW EXECUTE FUNCTION reject_change();
