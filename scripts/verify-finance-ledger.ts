// 任务 14 财务流水 — 端到端验证
//
// 依赖：prisma DB 已 seed（含 settlement / withdrawRequest / payoutRecord）
// 跑法：npx tsx scripts/verify-finance-ledger.ts
//
// 9 场景：
//   1. recordOrderCommission 写 order_commission 成功
//   2. 重复 recordOrderCommission 触发 unique 约束（幂等返回 ok:false）
//   3. recordWithdraw 写 withdraw 成功
//   4. 重复 recordWithdraw 触发 unique 约束
//   5. recordPayout 写 payout 成功
//   6. 重复 recordPayout 触发 unique 约束
//   7. listFinanceLedgers 多维过滤（type / merchantId）
//   8. getFinanceLedgerStats 统计卡正确（totalOut / thisMonthOut / byType）
//   9. getMerchantLedgerBalance 余额公式：Σ(commission) − Σ(withdraw) − Σ(payout)

import { Prisma } from "@prisma/client";
import {
  getFinanceLedgerStats,
  getMerchantLedgerBalance,
  listFinanceLedgers,
  recordOrderCommission,
  recordPayout,
  recordWithdraw,
} from "../src/lib/finance-ledger";
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
// Setup — 独立 merchant（不入 seed 主数据）
// ============================================================
let testMerchantId = "";

async function setup() {
  const now = Date.now().toString().slice(-9);
  const merchant = await prisma.merchant.create({
    data: {
      name: "verify ledger test",
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
}

async function cleanup() {
  // 先删 financeLedger 再删 merchant（cascade 也能删，这里显式确保）
  if (testMerchantId) {
    await prisma.financeLedger.deleteMany({
      where: { merchantId: testMerchantId },
    });
    await prisma.merchant.deleteMany({ where: { id: testMerchantId } });
  }
  testMerchantId = "";
}

// 辅助：先清掉某 sourceId 的 ledger（重复场景用）
async function clearLedger(type: string, sourceId: string) {
  await prisma.financeLedger.deleteMany({ where: { type, sourceId } });
}

(async () => {
  await cleanup();
  await setup();

  try {
    // --- 场景 1: recordOrderCommission 成功
    {
      const r = await recordOrderCommission({
        settlementId: "fake-settlement-001",
        merchantId: testMerchantId,
        merchantIncomeCents: 10000,
      });
      assert("场景 1: recordOrderCommission(¥100) → ok", r.ok);
      if (r.ok) {
        const stored = await prisma.financeLedger.findUnique({
          where: { id: r.id },
        });
        // # documents current behavior: PG numeric(12,2) 读取后 toString() 不带尾零
        assert(
          "场景 1: DB 金额数值 = 100（numeric(12,2) 读取不带尾零）",
          stored !== null && Number(stored.amount) === 100,
          `amount=${stored?.amount.toString()}`,
        );
        assert(
          "场景 1: type=order_commission, direction=out",
          stored?.type === "order_commission" && stored?.direction === "out",
        );
      }
    }

    // --- 场景 2: 重复 recordOrderCommission 触发 unique 约束（幂等）
    {
      const r = await recordOrderCommission({
        settlementId: "fake-settlement-001",
        merchantId: testMerchantId,
        merchantIncomeCents: 10000,
      });
      assert(
        "场景 2: 重复 recordOrderCommission → ok:false（幂等保护）",
        !r.ok,
      );
      if (!r.ok) {
        assert(
          "场景 2: error 含「重复记账」",
          r.error.includes("重复记账"),
          `error=${r.error}`,
        );
      }
    }

    // --- 场景 3: recordWithdraw 成功
    {
      const r = await recordWithdraw({
        withdrawRequestId: "fake-withdraw-001",
        merchantId: testMerchantId,
        amountCents: 2000,
      });
      assert("场景 3: recordWithdraw(¥20) → ok", r.ok);
      if (r.ok) {
        const stored = await prisma.financeLedger.findUnique({
          where: { id: r.id },
        });
        assert(
          "场景 3: DB 金额数值 = 20",
          stored !== null && Number(stored.amount) === 20,
          `amount=${stored?.amount.toString()}`,
        );
      }
    }

    // --- 场景 4: 重复 recordWithdraw 触发 unique 约束
    {
      const r = await recordWithdraw({
        withdrawRequestId: "fake-withdraw-001",
        merchantId: testMerchantId,
        amountCents: 2000,
      });
      assert("场景 4: 重复 recordWithdraw → ok:false", !r.ok);
    }

    // --- 场景 5: recordPayout 成功
    {
      const r = await recordPayout({
        payoutRecordId: "fake-payout-001",
        merchantId: testMerchantId,
        amountCents: 3000,
      });
      assert("场景 5: recordPayout(¥30) → ok", r.ok);
      if (r.ok) {
        const stored = await prisma.financeLedger.findUnique({
          where: { id: r.id },
        });
        assert(
          "场景 5: DB 金额数值 = 30",
          stored !== null && Number(stored.amount) === 30,
          `amount=${stored?.amount.toString()}`,
        );
      }
    }

    // --- 场景 6: 重复 recordPayout 触发 unique 约束
    {
      const r = await recordPayout({
        payoutRecordId: "fake-payout-001",
        merchantId: testMerchantId,
        amountCents: 3000,
      });
      assert("场景 6: 重复 recordPayout → ok:false", !r.ok);
    }

    // --- 场景 7: listFinanceLedgers 多维过滤
    {
      // 先添加一个不同商家的 ledger 测试 merchantId 过滤
      const otherMerchant = await prisma.merchant.create({
        data: {
          name: "verify ledger other",
          contactName: "测试",
          phone: `139000${Date.now().toString().slice(-9)}1`,
          inviteCode: `M${Date.now().toString().slice(-9)}`.slice(0, 8),
          province: "广东",
          city: "深圳",
          district: "南山",
          street: "测试",
          addressDetail: "1号",
          status: "active",
        },
      });
      try {
        await recordOrderCommission({
          settlementId: "fake-settlement-other-001",
          merchantId: otherMerchant.id,
          merchantIncomeCents: 5000,
        });

        // 只 filter type=withdraw
        const wdOnly = await listFinanceLedgers({ type: "withdraw" });
        assert(
          "场景 7-1: filter type=withdraw 只查 withdraw 类型",
          wdOnly.length >= 1 &&
            wdOnly.every((l) => l.type === "withdraw") &&
            wdOnly.every((l) => l.merchantId === testMerchantId),
          `count=${wdOnly.length}`,
        );

        // filter merchantId=testMerchantId
        const myOnly = await listFinanceLedgers({
          merchantId: testMerchantId,
        });
        assert(
          "场景 7-2: filter merchantId=本 merchant 查 3 条",
          myOnly.length === 3 &&
            myOnly.every((l) => l.merchantId === testMerchantId),
          `count=${myOnly.length}`,
        );

        // filter 两者结合
        const both = await listFinanceLedgers({
          type: "payout",
          merchantId: testMerchantId,
        });
        assert(
          "场景 7-3: filter type+merchantId 查到 1 条 payout",
          both.length === 1 && both[0]?.type === "payout",
          `count=${both.length}`,
        );

        // filter 不存在的 merchantId → 0 条
        const none = await listFinanceLedgers({
          merchantId: "nonexistent-merchant",
        });
        assert("场景 7-4: filter 不存在 merchant → 0 条", none.length === 0);
      } finally {
        await prisma.financeLedger.deleteMany({
          where: { merchantId: otherMerchant.id },
        });
        await prisma.merchant.delete({ where: { id: otherMerchant.id } });
      }
    }

    // --- 场景 8: getFinanceLedgerStats
    {
      const stats = await getFinanceLedgerStats({
        merchantId: testMerchantId,
      });
      // 本 merchant：commission=100, withdraw=20, payout=30
      assert(
        "场景 8-1: totalOut = 150.00",
        stats.totalOut === "150.00",
        `totalOut=${stats.totalOut}`,
      );
      assert(
        "场景 8-2: byType.order_commission = 100.00",
        stats.byType.order_commission === "100.00",
        `oc=${stats.byType.order_commission}`,
      );
      assert(
        "场景 8-3: byType.withdraw = 20.00",
        stats.byType.withdraw === "20.00",
        `wd=${stats.byType.withdraw}`,
      );
      assert(
        "场景 8-4: byType.payout = 30.00",
        stats.byType.payout === "30.00",
        `po=${stats.byType.payout}`,
      );
      // 本月流水：本场景全部都是今天创建 → 等于 totalOut
      assert(
        "场景 8-5: thisMonthOut = 150.00（今天记账）",
        stats.thisMonthOut === "150.00",
        `thisMonth=${stats.thisMonthOut}`,
      );

      // 全局 stats（不加 merchantId filter）
      const globalStats = await getFinanceLedgerStats();
      assert(
        "场景 8-6: 全局 totalOut ≥ 150（包含 seed 数据）",
        Number(globalStats.totalOut) >= 150,
        `globalTotal=${globalStats.totalOut}`,
      );
    }

    // --- 场景 9: getMerchantLedgerBalance 余额公式
    {
      const bal = await getMerchantLedgerBalance(testMerchantId);
      assert(
        "场景 9-1: totalCommission = 100.00",
        bal.totalCommission === "100.00",
        `oc=${bal.totalCommission}`,
      );
      assert(
        "场景 9-2: totalWithdraw = 20.00",
        bal.totalWithdraw === "20.00",
        `wd=${bal.totalWithdraw}`,
      );
      assert(
        "场景 9-3: totalPayout = 30.00",
        bal.totalPayout === "30.00",
        `po=${bal.totalPayout}`,
      );
      assert(
        "场景 9-4: balance = 100 - 20 - 30 = 50.00",
        bal.balance === "50.00",
        `balance=${bal.balance}`,
      );
    }

    // --- 边界场景：清掉 ledger 后 stats = 0
    {
      await clearLedger("order_commission", "fake-settlement-001");
      await clearLedger("withdraw", "fake-withdraw-001");
      await clearLedger("payout", "fake-payout-001");
      const stats = await getFinanceLedgerStats({
        merchantId: testMerchantId,
      });
      assert(
        "场景 10: 清空 ledger 后 totalOut = 0.00",
        stats.totalOut === "0.00",
        `totalOut=${stats.totalOut}`,
      );
    }
  } finally {
    await cleanup();
  }

  console.log(
    `\n=== 任务 14 verify 完成：${passed} passed / ${failed} failed ===`,
  );
  if (failed > 0) process.exit(1);
})();
