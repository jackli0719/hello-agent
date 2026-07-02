-- 任务 4 邀请码 + 入驻来源
--
-- 顺序（生产环境兼容已有数据）：
-- 1. ADD COLUMN nullable（无默认，让 ALTER 通过）
-- 2. UPDATE 已有行回填唯一邀请码（基于 id 哈希生成确定值，幂等）
-- 3. ALTER SET NOT NULL（保证后续新行也必须填）
-- 4. CREATE UNIQUE INDEX（约束）
--
-- Master.joinSource 直接加 DEFAULT 'admin_created' — 已有行自动填

-- AlterTable
ALTER TABLE "Master" ADD COLUMN     "joinSource" TEXT NOT NULL DEFAULT 'admin_created';

-- AlterTable: 先 nullable
ALTER TABLE "Merchant" ADD COLUMN     "inviteCode" TEXT,
ADD COLUMN     "inviteCodeEnabled" BOOLEAN NOT NULL DEFAULT true;

-- [任务 4 P0 修] 已有 Merchant 行回填唯一邀请码
-- 用 id 哈希生成 8 字符 — 相同 id 永远生成相同邀请码（幂等）
-- 用 || 字符串拼接 + MD5 — PG 兼容
UPDATE "Merchant"
SET "inviteCode" = UPPER(SUBSTRING(MD5('invite:' || "id"), 1, 8))
WHERE "inviteCode" IS NULL;

-- ALTER SET NOT NULL — 保证后续新行必须填
ALTER TABLE "Merchant" ALTER COLUMN "inviteCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_inviteCode_key" ON "Merchant"("inviteCode");
