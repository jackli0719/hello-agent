-- CreateTable
CREATE TABLE "MerchantSettlement" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "totalOrderCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL DEFAULT 0,
    "platformFee" INTEGER NOT NULL DEFAULT 0,
    "merchantIncome" INTEGER NOT NULL DEFAULT 0,
    "workerIncome" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerchantSettlement_period_idx" ON "MerchantSettlement"("period");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettlement_merchantId_period_key" ON "MerchantSettlement"("merchantId", "period");

-- AddForeignKey
ALTER TABLE "MerchantSettlement" ADD CONSTRAINT "MerchantSettlement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

