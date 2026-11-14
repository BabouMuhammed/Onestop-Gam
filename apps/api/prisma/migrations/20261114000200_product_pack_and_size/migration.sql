-- Pack-to-piece conversion and a size attribute on products.
ALTER TABLE "Product" ADD COLUMN "packSize" INTEGER;
ALTER TABLE "Product" ADD COLUMN "size" TEXT;
ALTER TABLE "Product" ADD CONSTRAINT "Product_pack_size_valid" CHECK ("packSize" IS NULL OR "packSize" >= 2);
