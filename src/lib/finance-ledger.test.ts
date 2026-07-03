// [P0 必修 2026-07-03] FinanceLedger 业务规则 + 事务版 API 测试
//
// 覆盖：
// - 旧 record* API：写成功 + 重复记账返 ok:false（P2002 不抛错）
// - 新 record*InTx API：写成功 + 重复记账 P2002 冒泡（事务回滚信号）
// - getMerchantLedgerBalance 公式：commission - withdraw - payout = balance

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import {
  getMerchantLedgerBalance,
  recordOrderCommission,
  recordOrderCommissionInTx,
  recordPayout,
  recordPayoutInTx,
  recordWithdraw,
  recordWithdrawInTx,
} from "./finance-ledger";

async function createTestMerchant() {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`.slice(-10);
  return prisma.merchant.create({
    data: {
      name: `finance ledger test ${suffix}`,
      contactName: "测试",
      phone: `139${suffix.slice(-8)}`,
      inviteCode: `FL${suffix}`.slice(0, 8),
      province: "广东",
      city: "深圳",
      district: "南山",
      street: "测试街",
      addressDetail: "1号",
      status: "active",
    },
  });
}

async function cleanupMerchant(merchantId: string) {
  await prisma.merchant.deleteMany({ where: { id: merchantId } });
}

describe("[P0-3] 旧 record* API — 非事务，catch P2002 返 ok:false", () => {
  let merchantId: string;

  beforeEach(async () => {
    merchantId = (await createTestMerchant()).id;
  });

  afterEach(async () => {
    await cleanupMerchant(merchantId);
  });

  // # spec: recordOrderCommission 成功 → ok:true
  it("recordOrderCommission 成功", async () => {
    const r = await recordOrderCommission({
      settlementId: "test-source-1",
      merchantId,
      merchantIncomeCents: 5000,
      remark: "[TEST] commission",
    });
    expect(r.ok).toBe(true);
  });

  // # spec: 重复 sourceId → P2002 被 catch → ok:false 不抛错
  it("重复 sourceId → 返 ok:false 不抛错", async () => {
    const r1 = await recordOrderCommission({
      settlementId: "test-dup-1",
      merchantId,
      merchantIncomeCents: 5000,
      remark: "[TEST] first",
    });
    expect(r1.ok).toBe(true);

    const r2 = await recordOrderCommission({
      settlementId: "test-dup-1",
      merchantId,
      merchantIncomeCents: 5000,
      remark: "[TEST] dup",
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error).toMatch(/重复记账/);
    }
  });
});

describe("[P0-3] 新 record*InTx API — 事务内，P2002 冒泡", () => {
  let merchantId: string;

  beforeEach(async () => {
    merchantId = (await createTestMerchant()).id;
  });

  afterEach(async () => {
    await cleanupMerchant(merchantId);
  });

  // # spec: 事务内 recordOrderCommissionInTx 成功
  it("recordOrderCommissionInTx 成功", async () => {
    await prisma.$transaction(async (tx) => {
      const r = await recordOrderCommissionInTx(tx, {
        settlementId: "test-intx-1",
        merchantId,
        merchantIncomeCents: 8000,
        remark: "[TEST] intx commission",
      });
      expect(r.id).toBeTruthy();
    });
  });

  // # spec: 事务内重复记账 P2002 冒泡 → 整个事务回滚
  it("重复 sourceId 在事务内 → P2002 冒泡", async () => {
    // 先写一笔
    await prisma.$transaction(async (tx) => {
      await recordOrderCommissionInTx(tx, {
        settlementId: "test-intx-dup",
        merchantId,
        merchantIncomeCents: 5000,
        remark: "[TEST] first",
      });
    });

    // 再写同一 sourceId 应冒泡 P2002
    await expect(
      prisma.$transaction(async (tx) => {
        await recordOrderCommissionInTx(tx, {
          settlementId: "test-intx-dup",
          merchantId,
          merchantIncomeCents: 5000,
          remark: "[TEST] second",
        });
      }),
    ).rejects.toThrow();
  });

  // # spec: recordWithdrawInTx + recordPayoutInTx 在事务内可用
  it("recordWithdrawInTx + recordPayoutInTx 在事务内可用", async () => {
    await prisma.$transaction(async (tx) => {
      await recordWithdrawInTx(tx, {
        withdrawRequestId: "test-intx-wr",
        merchantId,
        amountCents: 3000,
        remark: "[TEST] withdraw",
      });
      await recordPayoutInTx(tx, {
        payoutRecordId: "test-intx-po",
        merchantId,
        amountCents: 3000,
        remark: "[TEST] payout",
      });
    });

    const ledgers = await prisma.financeLedger.findMany({
      where: {
        merchantId,
        OR: [{ sourceId: "test-intx-wr" }, { sourceId: "test-intx-po" }],
      },
    });
    expect(ledgers).toHaveLength(2);
  });
});

describe("getMerchantLedgerBalance — 余额公式", () => {
  // # spec: 余额 = order_commission - withdraw - payout
  it("空 ledger → 全 0", async () => {
    const target = await createTestMerchant();
    const r = await getMerchantLedgerBalance(target.id);
    expect(r.totalCommission).toBe("0.00");
    expect(r.totalWithdraw).toBe("0.00");
    expect(r.totalPayout).toBe("0.00");
    expect(r.balance).toBe("0.00");
    await cleanupMerchant(target.id);
  });

  // # spec: 写入 commission + withdraw + payout 后公式正确
  it("公式: balance = commission - withdraw - payout", async () => {
    const merchantId = (await createTestMerchant()).id;

    const sourceIds = [
      `test-balance-oc-${Date.now()}`,
      `test-balance-wd-${Date.now()}`,
      `test-balance-po-${Date.now()}`,
    ];

    await prisma.$transaction(async (tx) => {
      await recordOrderCommissionInTx(tx, {
        settlementId: sourceIds[0],
        merchantId,
        merchantIncomeCents: 100000, // ¥1000
        remark: "[TEST] balance oc",
      });
      await recordWithdrawInTx(tx, {
        withdrawRequestId: sourceIds[1],
        merchantId,
        amountCents: 30000, // ¥300
        remark: "[TEST] balance wd",
      });
      await recordPayoutInTx(tx, {
        payoutRecordId: sourceIds[2],
        merchantId,
        amountCents: 20000, // ¥200
        remark: "[TEST] balance po",
      });
    });

    const r = await getMerchantLedgerBalance(merchantId);
    expect(r.totalCommission).toBe("1000.00");
    expect(r.totalWithdraw).toBe("300.00");
    expect(r.totalPayout).toBe("200.00");
    expect(r.balance).toBe("500.00");

    await cleanupMerchant(merchantId);
  });
});

// 防 unused import 警告
void recordWithdraw;
void recordPayout;
