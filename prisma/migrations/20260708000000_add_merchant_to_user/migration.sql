-- [任务 18] 商家端后台 — User 表加 merchantId 字段
--
-- 设计：
-- - merchantId 为可空 STRING — 角色 4 种（admin/worker/customer/merchant），且演示期仅 merchant role 用得上
-- - onDelete: SetNull — 商家删除时其后台账号保留（演示期安全；上线应改 Cascade）
-- - 索引：merchantId 单字段索引（hot query: WHERE merchantId = ?）

-- AlterTable
ALTER TABLE "User" ADD COLUMN "merchantId" TEXT;

-- CreateIndex
CREATE INDEX "User_merchantId_idx" ON "User"("merchantId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
