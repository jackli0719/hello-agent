-- CreateTable
CREATE TABLE "SettlementPreview" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "masterId" TEXT NOT NULL,
    "strategyId" TEXT,
    "orderAmount" INTEGER NOT NULL,
    "platformAmount" INTEGER NOT NULL,
    "merchantAmount" INTEGER NOT NULL,
    "workerAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementPreview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SettlementPreview_orderId_key" ON "SettlementPreview"("orderId");

-- CreateIndex
CREATE INDEX "SettlementPreview_merchantId_idx" ON "SettlementPreview"("merchantId");

-- CreateIndex
CREATE INDEX "SettlementPreview_status_idx" ON "SettlementPreview"("status");

-- AddForeignKey
ALTER TABLE "SettlementPreview" ADD CONSTRAINT "SettlementPreview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementPreview" ADD CONSTRAINT "SettlementPreview_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementPreview" ADD CONSTRAINT "SettlementPreview_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "Master"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementPreview" ADD CONSTRAINT "SettlementPreview_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "CommissionStrategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

