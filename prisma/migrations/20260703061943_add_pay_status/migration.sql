/*
  Warnings:

  - Made the column `status` on table `MerchantSettlement` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "MerchantSettlement" ALTER COLUMN "status" SET NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "payStatus" TEXT NOT NULL DEFAULT 'unpaid';
