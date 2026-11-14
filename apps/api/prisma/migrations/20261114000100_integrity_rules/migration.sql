-- Rules the Prisma schema cannot express. They are the last line of defence:
-- even a bug in the application cannot break them.

-- Stock can never go below zero, and prices can never be negative.
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_quantity_not_negative" CHECK ("quantity" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_balance_not_negative" CHECK ("balanceAfter" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_not_negative" CHECK ("sellingPrice" IS NULL OR "sellingPrice" >= 0);

-- Managers and cashiers belong to exactly one division; CEO and Finance to none.
ALTER TABLE "User" ADD CONSTRAINT "User_role_matches_division" CHECK (
  ("role" IN ('MANAGER', 'CASHIER') AND "divisionId" IS NOT NULL)
  OR ("role" IN ('CEO', 'FINANCE') AND "divisionId" IS NULL)
);

-- The stock ledger, price history and audit log are append-only.
CREATE FUNCTION reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockMovement_append_only" BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION reject_change();

CREATE TRIGGER "PriceChange_append_only" BEFORE UPDATE OR DELETE ON "PriceChange"
  FOR EACH ROW EXECUTE FUNCTION reject_change();

CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
