-- [任务 T2-1] WorkerWithdrawRequest: 师傅提现申请
--
-- 设计：
-- - 镜像 WithdrawRequest 模型，但 FK 改为 Master
-- - 金额单位：分（与 WorkerSettlement 一致）
-- - 状态：pending / approved / rejected
-- - 师傅自己申请；admin 审核；不写 FinanceLedger
-- - partial unique index: (workerId) WHERE status = 'pending'
--   防同师傅并发创建 2 条 pending（与 WithdrawRequest 同样的 P0 风险）
--
-- 修复 P0-1 风险：避免"check → count → aggregate → create"无事务无唯一约束

CREATE TABLE "WorkerWithdrawRequest" (
  "id" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "remark" TEXT,
  "reviewerName" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerWithdrawRequest_pkey" PRIMARY KEY ("id")
);

-- FK Master (Cascade) — 删师傅自动清申请
ALTER TABLE "WorkerWithdrawRequest"
  ADD CONSTRAINT "WorkerWithdrawRequest_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "Master"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "WorkerWithdrawRequest_workerId_idx" ON "WorkerWithdrawRequest"("workerId");
CREATE INDEX "WorkerWithdrawRequest_status_idx" ON "WorkerWithdrawRequest"("status");
CREATE INDEX "WorkerWithdrawRequest_createdAt_idx" ON "WorkerWithdrawRequest"("createdAt");

-- P0 必修：partial unique 防同 worker 多 pending
CREATE UNIQUE INDEX "WorkerWithdrawRequest_pending_per_worker"
  ON "WorkerWithdrawRequest"("workerId")
  WHERE status = 'pending';
