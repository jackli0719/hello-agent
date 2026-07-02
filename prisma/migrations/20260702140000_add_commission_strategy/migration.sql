-- CreateTable
CREATE TABLE "CommissionStrategy" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strategyType" TEXT NOT NULL,
    "platformRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "merchantRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "workerRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fixedPlatformAmount" INTEGER NOT NULL DEFAULT 0,
    "fixedMerchantAmount" INTEGER NOT NULL DEFAULT 0,
    "fixedWorkerAmount" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionStrategy_merchantId_idx" ON "CommissionStrategy"("merchantId");

-- CreateIndex
CREATE INDEX "CommissionStrategy_enabled_idx" ON "CommissionStrategy"("enabled");

-- AddForeignKey
ALTER TABLE "CommissionStrategy" ADD CONSTRAINT "CommissionStrategy_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

