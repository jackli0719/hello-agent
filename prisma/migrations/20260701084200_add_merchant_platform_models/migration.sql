-- AlterTable
ALTER TABLE "Master" ADD COLUMN     "merchantId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "PlatformArea" (
    "id" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "addressDetail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantArea" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "platformAreaId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformArea_enabled_idx" ON "PlatformArea"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformArea_province_city_district_street_key" ON "PlatformArea"("province", "city", "district", "street");

-- CreateIndex
CREATE INDEX "Merchant_status_idx" ON "Merchant"("status");

-- CreateIndex
CREATE INDEX "Merchant_province_city_district_street_idx" ON "Merchant"("province", "city", "district", "street");

-- CreateIndex
CREATE INDEX "MerchantArea_merchantId_idx" ON "MerchantArea"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantArea_platformAreaId_idx" ON "MerchantArea"("platformAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantArea_merchantId_platformAreaId_key" ON "MerchantArea"("merchantId", "platformAreaId");

-- CreateIndex
CREATE INDEX "Master_merchantId_idx" ON "Master"("merchantId");

-- AddForeignKey
ALTER TABLE "Master" ADD CONSTRAINT "Master_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantArea" ADD CONSTRAINT "MerchantArea_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantArea" ADD CONSTRAINT "MerchantArea_platformAreaId_fkey" FOREIGN KEY ("platformAreaId") REFERENCES "PlatformArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
