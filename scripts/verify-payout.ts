// 任务 12 线下打款记录 — 8 场景端到端验证
//
// 依赖：prisma DB 已 seed（3 商家 / 5 师傅 / 订单 / commissionStrategy / MerchantSettlement）
// 跑法：npx tsx scripts/verify-payout.ts
//
// ⚠️ 临时改 DB：
//   - 新建若干 MerchantSettlement (archived / pending)
//   - 新建若干 PayoutRecord
// finally 强制删除所有测试 settlement + payout
//
// 8 场景：
//   1. 正常创建 PayoutRecord（archived settlement，amount < merchantIncome）
//   2. Σ 校验：累计 amount ≤ merchantIncome（边界：恰好等于）
//   3. 拒绝：状态=pending 的 settlement 录打款
//   4. 允许：状态=confirmed 的 settlement 录打款
//   5. 允许：状态=archived 的 settlement 录打款（场景 1 复用）
//   6. 拒绝：Σ(amount) 超过 merchantIncome
//   7. 拒绝：proofUrl 非 http(s)://
//   8. 列表查询：listAllPayouts 能查到 + 详情页 sumPayoutsBySettlement 正确

import {
  createPayoutRecord,
  listAllPayouts,
  sumPayoutsBySettlement,
} from "../src/lib/payout";
import { prisma } from "../src/lib/db";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ============================================================
// Setup — 创建 3 条临时 MerchantSettlement（archived / confirmed / pending）
// ============================================================
const snap = {
  settlementIds: [] as string[],
};

async function setup() {
  // 找一个 active merchant + strategy
  const merchant = await prisma.merchant.findFirst({
    where: { status: "active" },
    include: { commissionStrategies: { where: { enabled: true } } },
  });
  if (!merchant) throw new Error("找不到 active merchant — 请先 seed");
  const strategy = merchant.commissionStrategies[0] ?? null;

  // merchantIncome = 10000 (¥100.00) for testability
  const merchantIncome = 10000;

  const base = {
    merchantId: merchant.id,
    period: "2099-01", // 远期 — 不与 seed 撞
    totalOrderCount: 1,
    totalAmount: 30000,
    platformFee: 20000,
    merchantIncome,
    workerIncome: 0,
  };

  // archived
  const archived = await prisma.merchantSettlement.create({
    data: { ...base, status: "archived" },
  });
  snap.settlementIds.push(archived.id);

  // confirmed
  const confirmed = await prisma.merchantSettlement.create({
    data: { ...base, period: "2099-02", status: "confirmed" },
  });
  snap.settlementIds.push(confirmed.id);

  // pending
  const pending = await prisma.merchantSettlement.create({
    data: { ...base, period: "2099-03", status: "pending" },
  });
  snap.settlementIds.push(pending.id);

  return { archived, confirmed, pending, strategy };
}

async function cleanup() {
  // 删 payout（Cascade 会跟随 settlement）
  await prisma.merchantSettlement.deleteMany({
    where: { id: { in: snap.settlementIds } },
  });
}

// ============================================================
// Tests
// ============================================================
async function run() {
  const { archived, confirmed, pending } = await setup();
  console.log(
    `  ℹ️  测试用 settlement: archived=${archived.id.slice(0, 8)}… / confirmed=${confirmed.id.slice(0, 8)}… / pending=${pending.id.slice(0, 8)}…`,
  );

  // 场景 1: archived + amount < merchantIncome → ok
  const r1 = await createPayoutRecord({
    withdrawRequestId: archived.id,
    amount: 3000,
    paidAt: new Date("2026-06-15T10:00:00Z"),
    proofUrl: "https://example.com/proof/001",
    operator: "admin-test",
  });
  assert(
    "场景 1: archived 录打款 ¥30（amount < merchantIncome）",
    r1.ok && r1.cumulative === 3000 && r1.remaining === 7000,
    r1.ok
      ? `cumulative=¥${r1.cumulative / 100} remaining=¥${r1.remaining / 100}`
      : r1.error,
  );

  // 场景 2: Σ 校验 — 再录一笔 ¥70，cumulative = 100 == merchantIncome
  const r2 = await createPayoutRecord({
    withdrawRequestId: archived.id,
    amount: 7000,
    paidAt: new Date("2026-06-15T10:00:00Z"),
    proofUrl: null,
    operator: "admin-test",
  });
  assert(
    "场景 2: Σ 校验 — 累计 = merchantIncome 允许（恰好等于）",
    r2.ok && r2.cumulative === 10000 && r2.remaining === 0,
    r2.ok ? `cumulative=¥${r2.cumulative / 100}` : r2.error,
  );

  // 场景 3: pending 拒绝
  const r3 = await createPayoutRecord({
    withdrawRequestId: pending.id,
    amount: 1000,
    paidAt: new Date("2026-06-15T10:00:00Z"),
    proofUrl: null,
    operator: "admin-test",
  });
  assert(
    "场景 3: pending 状态拒绝录打款",
    !r3.ok && /待确认|已确认/.test(r3.error),
    !r3.ok ? `error=${r3.error}` : `UNEXPECTED ok`,
  );

  // 场景 4: confirmed 允许
  const r4 = await createPayoutRecord({
    withdrawRequestId: confirmed.id,
    amount: 2000,
    paidAt: new Date("2026-06-15T10:00:00Z"),
    proofUrl: "https://example.com/proof/confirmed",
    operator: "admin-test",
  });
  assert(
    "场景 4: confirmed 状态允许录打款",
    r4.ok && r4.cumulative === 2000,
    r4.ok ? `cumulative=¥${r4.cumulative / 100}` : r4.error,
  );

  // 场景 5: archived（场景 1 复用 — 已经录过 — 再录一笔）
  const r5 = await createPayoutRecord({
    withdrawRequestId: archived.id,
    amount: 1, // 边界：Σ 已 10000，再加 1 就超额
    paidAt: new Date("2026-06-15T10:00:00Z"),
    proofUrl: null,
    operator: "admin-test",
  });
  assert(
    "场景 5: archived 超额（Σ 10000 + 1 > 10000）拒绝",
    !r5.ok && /超过应收金额/.test(r5.error),
    !r5.ok ? `error=${r5.error}` : `UNEXPECTED ok`,
  );

  // 场景 6: 超额拒绝（confirmed 上加 — Σ 已 2000，加 9000 = 11000 > 10000）
  const r6 = await createPayoutRecord({
    withdrawRequestId: confirmed.id,
    amount: 9000,
    paidAt: new Date("2026-06-15T10:00:00Z"),
    proofUrl: null,
    operator: "admin-test",
  });
  assert(
    "场景 6: 超额拒绝（Σ 2000 + 9000 > 10000）",
    !r6.ok && /超过应收金额/.test(r6.error),
    !r6.ok ? `error=${r6.error}` : `UNEXPECTED ok`,
  );

  // 场景 7: proofUrl 非 http(s):// 拒绝
  const r7 = await createPayoutRecord({
    withdrawRequestId: confirmed.id,
    amount: 100,
    paidAt: new Date("2026-06-15T10:00:00Z"),
    proofUrl: "ftp://example.com/proof",
    operator: "admin-test",
  });
  assert(
    "场景 7: proofUrl 非 http(s):// 拒绝",
    !r7.ok && /http/.test(r7.error),
    !r7.ok ? `error=${r7.error}` : `UNEXPECTED ok`,
  );

  // 场景 8: listAllPayouts + sumPayoutsBySettlement
  const allPayouts = await listAllPayouts();
  // 至少有 3 笔：场景 1 + 2（archived） + 场景 4（confirmed） + seed 那 1 条
  const testPayouts = allPayouts.filter((p) =>
    [archived.id, confirmed.id].includes(p.settlement.id),
  );
  const sumArchived = await sumPayoutsBySettlement(archived.id);
  const sumConfirmed = await sumPayoutsBySettlement(confirmed.id);
  assert(
    "场景 8a: listAllPayouts 包含测试 payout",
    testPayouts.length >= 3,
    `test payouts=${testPayouts.length} (total all=${allPayouts.length})`,
  );
  assert(
    "场景 8b: sumPayoutsBySettlement(archived) = 10000",
    sumArchived === 10000,
    `sum=¥${sumArchived / 100}`,
  );
  assert(
    "场景 8c: sumPayoutsBySettlement(confirmed) = 2000",
    sumConfirmed === 2000,
    `sum=¥${sumConfirmed / 100}`,
  );
}

(async () => {
  try {
    await run();
  } catch (e) {
    console.error("❌ 测试异常:", e);
    failed++;
  } finally {
    await cleanup();
    console.log("");
    console.log("=".repeat(50));
    console.log(
      `✅ 通过: ${passed}  ❌ 失败: ${failed}  共: ${passed + failed}`,
    );
    if (failed > 0) process.exit(1);
  }
})();
