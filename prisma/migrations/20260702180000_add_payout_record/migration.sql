-- CreateTable
CREATE TABLE "PayoutRecord" (
    "id" TEXT NOT NULL,
    "withdrawRequestId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "proofUrl" TEXT,
    "operator" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutRecord_withdrawRequestId_idx" ON "PayoutRecord"("withdrawRequestId");

-- CreateIndex
CREATE INDEX "PayoutRecord_merchantId_idx" ON "PayoutRecord"("merchantId");

-- CreateIndex
CREATE INDEX "PayoutRecord_paidAt_idx" ON "PayoutRecord"("paidAt");

-- AddForeignKey
ALTER TABLE "PayoutRecord" ADD CONSTRAINT "PayoutRecord_withdrawRequestId_fkey" FOREIGN KEY ("withdrawRequestId") REFERENCES "MerchantSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRecord" ADD CONSTRAINT "PayoutRecord_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

