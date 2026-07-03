-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "afterSalesHandledAt" TIMESTAMP(3),
ADD COLUMN     "afterSalesHandledBy" TEXT,
ADD COLUMN     "afterSalesReason" TEXT,
ADD COLUMN     "afterSalesRejectReason" TEXT,
ADD COLUMN     "afterSalesStatus" TEXT;

-- CreateIndex
CREATE INDEX "Order_afterSalesStatus_idx" ON "Order"("afterSalesStatus");
