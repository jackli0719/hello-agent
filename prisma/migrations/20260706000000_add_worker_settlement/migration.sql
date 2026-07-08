-- [任务 17] WorkerSettlement — 师傅维度结算汇总（按 worker × period）
--
-- 设计要点：
-- - workerId: FK Master (Cascade)
-- - period: "YYYY-MM"
-- - orderCount / totalAmount / workerIncome: 来自 SettlementPreview 聚合
-- - 无 status 字段（仅展示用，不走打款）
-- - 唯一约束: (workerId, period) — 同师傅同月只一条
--
-- 数据源：prisma.settlementPreview
-- 生成时机：admin 手动点 "生成汇总" 按钮
-- 复用现有索引：Master 表已有 @@index([merchantId])

-- CreateTable
CREATE TABLE "WorkerSettlement" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL DEFAULT 0,
    "workerIncome" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerSettlement_period_idx" ON "WorkerSettlement"("period");

-- CreateIndex
CREATE INDEX "WorkerSettlement_workerId_idx" ON "WorkerSettlement"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerSettlement_workerId_period_key" ON "WorkerSettlement"("workerId", "period");

-- AddForeignKey
ALTER TABLE "WorkerSettlement" ADD CONSTRAINT "WorkerSettlement_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Master"("id") ON DELETE CASCADE ON UPDATE CASCADE;
