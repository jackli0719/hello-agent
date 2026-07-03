// [任务 16] 财务链路 integration test — T14 finance-ledger 端到端
//
// 起源：scripts/verify-finance-ledger.ts（任务 14 端到端验证脚本）
// 迁移原因（P1-#5）：verify 脚本不在 npm run test 链路，CI 不会触发；财务核心链路应进 Vitest。
//
// 与 src/lib/finance-ledger.test.ts 的分工：
// - 单测：覆盖 recordOrderCommission/Withdraw/Payout 写 + 重复幂等 + getMerchantLedgerBalance 公式
// - 本 integration：覆盖 **多维过滤**（listFinanceLedgers）+ **统计卡**（getFinanceLedgerStats 5 项）
//
// 设计：
// - 跑前自建独立 merchant（cleanupFor 兜底）
// - 跑后强制删 ledger + merchant（避免污染 seed 数据）
// - 共享 dev DB（vitest.config.ts fileParallelism: false）
//
// 覆盖：
// 1. listFinanceLedgers 多维过滤（type / merchantId / 组合 / 不存在）
// 2. getFinanceLedgerStats 统计卡（totalOut / thisMonthOut / byType）
// 3. 清空 ledger 后 stats = 0
//
// # spec: 多维过滤 — listFinanceLedgers 支持 type / merchantId 独立或组合
// # spec: 统计卡 — totalOut / thisMonthOut / byType 三项聚合正确
// # spec: 测试数据隔离 — 自建 merchant + cleanup 不污染 seed 数据

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import {
  getFinanceLedgerStats,
  listFinanceLedgers,
  recordOrderCommission,
  recordPayout,
  recordWithdraw,
} from "@/src/lib/finance-ledger";

describe("T14 finance-ledger — integration smoke", () => {
  let testMerchantId: string;

  beforeAll(async () => {
    // 独立 merchant（不入 seed 主数据）
    const now = Date.now().toString().slice(-9);
    const merchant = await prisma.merchant.create({
      data: {
        name: "integration ledger test",
        contactName: "测试",
        phone: `139000${now}`,
        inviteCode: `L${now}`.slice(0, 8),
        province: "广东",
        city: "深圳",
        district: "南山",
        street: "测试街",
        addressDetail: "1号",
        status: "active",
      },
    });
    testMerchantId = merchant.id;

    // 灌 3 类 ledger：order_commission(¥100) + withdraw(¥20) + payout(¥30)
    const oc = await recordOrderCommission({
      settlementId: "integration-settlement-001",
      merchantId: testMerchantId,
      merchantIncomeCents: 10000,
    });
    expect(oc.ok).toBe(true);

    const wd = await recordWithdraw({
      withdrawRequestId: "integration-withdraw-001",
      merchantId: testMerchantId,
      amountCents: 2000,
    });
    expect(wd.ok).toBe(true);

    const po = await recordPayout({
      payoutRecordId: "integration-payout-001",
      merchantId: testMerchantId,
      amountCents: 3000,
    });
    expect(po.ok).toBe(true);
  });

  afterAll(async () => {
    // 先删 ledger 再删 merchant（cascade 也能删，这里显式确保）
    if (testMerchantId) {
      await prisma.financeLedger.deleteMany({
        where: { merchantId: testMerchantId },
      });
      await prisma.merchant.deleteMany({ where: { id: testMerchantId } });
    }
  });

  // # spec: 多维过滤 — type=withdraw 只查 withdraw 类型
  it("场景 7-1: filter type=withdraw 只查 withdraw 类型", async () => {
    const wdOnly = await listFinanceLedgers({ type: "withdraw" });
    expect(wdOnly.length).toBeGreaterThanOrEqual(1);
    expect(wdOnly.every((l) => l.type === "withdraw")).toBe(true);
    // 至少包含本测试 merchant 的那条
    expect(wdOnly.some((l) => l.merchantId === testMerchantId)).toBe(true);
  });

  // # spec: 多维过滤 — merchantId 只查本 merchant
  it("场景 7-2: filter merchantId=本 merchant 查 3 条 (commission + withdraw + payout)", async () => {
    const myOnly = await listFinanceLedgers({ merchantId: testMerchantId });
    expect(myOnly.length).toBe(3);
    expect(myOnly.every((l) => l.merchantId === testMerchantId)).toBe(true);
    const types = myOnly.map((l) => l.type).sort();
    expect(types).toEqual(["order_commission", "payout", "withdraw"]);
  });

  // # spec: 多维过滤 — type + merchantId 组合
  it("场景 7-3: filter type+merchantId 查到 1 条 payout", async () => {
    const both = await listFinanceLedgers({
      type: "payout",
      merchantId: testMerchantId,
    });
    expect(both.length).toBe(1);
    expect(both[0]?.type).toBe("payout");
    expect(both[0]?.merchantId).toBe(testMerchantId);
  });

  // # spec: 多维过滤 — 不存在的 merchantId → 0 条
  it("场景 7-4: filter 不存在 merchantId → 0 条", async () => {
    const none = await listFinanceLedgers({
      merchantId: "nonexistent-merchant-id",
    });
    expect(none.length).toBe(0);
  });

  // # spec: 统计卡 — totalOut 聚合 = 100+20+30 = 150.00
  it("场景 8-1: getFinanceLedgerStats.totalOut = 150.00", async () => {
    const stats = await getFinanceLedgerStats({ merchantId: testMerchantId });
    expect(stats.totalOut).toBe("150.00");
  });

  // # spec: 统计卡 — byType 三类独立聚合
  it("场景 8-2: byType 三类独立聚合正确", async () => {
    const stats = await getFinanceLedgerStats({ merchantId: testMerchantId });
    expect(stats.byType.order_commission).toBe("100.00");
    expect(stats.byType.withdraw).toBe("20.00");
    expect(stats.byType.payout).toBe("30.00");
  });

  // # spec: 统计卡 — 本月流水 = totalOut (今天记账)
  it("场景 8-3: thisMonthOut = 150.00（今天记账）", async () => {
    const stats = await getFinanceLedgerStats({ merchantId: testMerchantId });
    expect(stats.thisMonthOut).toBe("150.00");
  });

  // # spec: 边界 — 清空 ledger 后 stats = 0
  it("场景 10: 清空 ledger 后 totalOut = 0.00", async () => {
    // 临时清掉 3 条 ledger
    await prisma.financeLedger.deleteMany({
      where: { merchantId: testMerchantId },
    });
    const stats = await getFinanceLedgerStats({ merchantId: testMerchantId });
    expect(stats.totalOut).toBe("0.00");
    expect(stats.byType.order_commission).toBe("0.00");
    expect(stats.byType.withdraw).toBe("0.00");
    expect(stats.byType.payout).toBe("0.00");
    expect(stats.thisMonthOut).toBe("0.00");

    // 重建 ledger 给 afterAll 清理不掉时也不残留（afterAll 会删 merchant，cascade 兜底）
    // 这里选择不重建 — afterAll 会兜底删 merchant
  });
});
