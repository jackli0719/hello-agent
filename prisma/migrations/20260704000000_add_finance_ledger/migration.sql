-- [任务 14] 财务流水（FinanceLedger）
--
-- 设计：
-- - merchantId 必填（FK Merchant，Cascade）
-- - type: order_commission | withdraw | payout
-- - direction: 'out'（MVP 简化，平台减项）
-- - sourceId: 关联业务对象 id（settlement / withdrawRequest / payoutRecord）
-- - amount: Decimal(12,2) — 元；PG 原生支持
-- - 幂等：@@unique([type, sourceId]) — 同 type+sourceId 只能 1 笔

CREATE TABLE "FinanceLedger" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'out',
    "sourceId" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceLedger_pkey" PRIMARY KEY ("id")
);

-- 幂等约束：同 type + sourceId 只能 1 笔
CREATE UNIQUE INDEX "FinanceLedger_type_sourceId_key" ON "FinanceLedger"("type", "sourceId");

-- 过滤索引
CREATE INDEX "FinanceLedger_merchantId_idx" ON "FinanceLedger"("merchantId");
CREATE INDEX "FinanceLedger_type_idx" ON "FinanceLedger"("type");
CREATE INDEX "FinanceLedger_createdAt_idx" ON "FinanceLedger"("createdAt");

-- FK Merchant（Cascade）
ALTER TABLE "FinanceLedger" ADD CONSTRAINT "FinanceLedger_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;