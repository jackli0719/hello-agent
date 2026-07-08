-- [任务 9+10] MerchantSettlement 状态机（pending/confirmed/archived）
--
-- 顺序（生产环境兼容已有数据）：
-- 1. ADD COLUMN nullable（无 default，让 ALTER 通过）
-- 2. UPDATE 已有行填默认 'pending'
-- 3. ALTER SET DEFAULT 'pending'（保证后续新行也默认）
-- 4. CREATE INDEX status

-- AlterTable: 先 nullable
ALTER TABLE "MerchantSettlement" ADD COLUMN "status" TEXT;

-- [任务 9+10 P0 修] 已有 MerchantSettlement 行回填 'pending'
UPDATE "MerchantSettlement"
SET "status" = 'pending'
WHERE "status" IS NULL;

-- ALTER SET DEFAULT — 保证后续新行默认 pending
ALTER TABLE "MerchantSettlement" ALTER COLUMN "status" SET DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "MerchantSettlement_status_idx" ON "MerchantSettlement"("status");
