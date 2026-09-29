-- CreateEnum
CREATE TYPE "ProductAccessStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ProductAccessSource" AS ENUM ('ORDER', 'MANUAL');

-- CreateTable
CREATE TABLE "ProductAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "ProductAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "ProductAccessSource" NOT NULL,
    "orderId" TEXT,
    "grantedByAdminId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductAccess_userId_idx" ON "ProductAccess"("userId");

-- CreateIndex
CREATE INDEX "ProductAccess_productId_idx" ON "ProductAccess"("productId");

-- CreateIndex
CREATE INDEX "ProductAccess_status_idx" ON "ProductAccess"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAccess_userId_productId_key" ON "ProductAccess"("userId", "productId");

-- AddForeignKey
ALTER TABLE "ProductAccess" ADD CONSTRAINT "ProductAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAccess" ADD CONSTRAINT "ProductAccess_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAccess" ADD CONSTRAINT "ProductAccess_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAccess" ADD CONSTRAINT "ProductAccess_grantedByAdminId_fkey" FOREIGN KEY ("grantedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill access from confirmed orders (one row per student + product)
INSERT INTO "ProductAccess" ("id", "userId", "productId", "status", "source", "orderId", "grantedAt", "updatedAt")
SELECT
    md5(o."id" || oi."productId"),
    o."userId",
    oi."productId",
    'ACTIVE'::"ProductAccessStatus",
    'ORDER'::"ProductAccessSource",
    o."id",
    COALESCE(o."confirmedAt", o."createdAt"),
    NOW()
FROM "Order" o
JOIN "OrderItem" oi ON oi."orderId" = o."id"
WHERE o."status" = 'CONFIRMED'
ON CONFLICT ("userId", "productId") DO NOTHING;
