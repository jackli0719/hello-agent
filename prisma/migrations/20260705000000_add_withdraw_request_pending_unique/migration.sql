-- [P0 必修] WithdrawRequest: 防同商家多 pending 并发超额
--
-- 设计：
-- - partial unique index: (merchantId) WHERE status = 'pending'
-- - 业务规则：「同一 merchant 不允许同时有 2 条 pending 申请」
-- - DB 层硬约束：两个并发 create 时，第二个 create 会因 unique 冲突抛 P2002
-- - 应用层（withdraw-request.ts）：事务 + Serializable 重算兜底
-- - PG 特性：partial unique index（SQLite 不支持，但当前已迁 PG）
--
-- 修复 P0-1 风险：src/lib/withdraw-request.ts:130 原"check → count → aggregate → create"无事务无唯一约束

CREATE UNIQUE INDEX "WithdrawRequest_pending_per_merchant"
  ON "WithdrawRequest"("merchantId")
  WHERE status = 'pending';