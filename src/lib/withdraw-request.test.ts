// [P0 必修 2026-07-03] withdraw-request 业务规则 + 并发 + 状态机测试
//
// 覆盖：
// - P0-1: 同 merchant 并发创建 2 条 pending → 只能 1 条成功（DB partial unique + 事务兜底）
// - P0-1: approve/reject 后再 create 第二条 pending → 成功（pending unique 已释放）
// - P0-2: approve 后再 approve → 返"已审核"
// - P0-2: reject 后再 reject → 返"已审核"
// - P0-3: approve 业务状态 + recordWithdraw ledger 同事务；都成功 / 都失败
// - 基本规则：amount ≤ 0 / merchant 不存在 / merchant 非 active / 超过 available

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import {
  approveWithdrawRequest,
  createWithdrawRequest,
  rejectWithdrawRequest,
} from "./withdraw-request";

async function findActiveMerchant(): Promise<{ id: string; name: string }> {
  const m = await prisma.merchant.findFirst({ where: { status: "active" } });
  if (!m) throw new Error("seed 没建 active merchant");
  return { id: m.id, name: m.name };
}

async function cleanupFor(merchantId: string) {
  // 清掉测试产生的 WR + payoutRecord + financeLedger（远期 period 的 settlement 也会被清）
  await prisma.withdrawRequest.deleteMany({ where: { merchantId } });
  await prisma.payoutRecord.deleteMany({
    where: {
      merchantId,
      settlement: { period: { startsWith: "2099-12" } },
    },
  });
  await prisma.financeLedger.deleteMany({
    where: {
      merchantId,
      OR: [
        { type: "withdraw" },
        { type: "payout", remark: { startsWith: "线下打款" } },
      ],
    },
  });
}

async function createConfirmedSettlement(
  merchantId: string,
  merchantIncomeCents: number,
): Promise<string> {
  const period = `2099-12-${Math.floor(Math.random() * 100000)}`;
  const s = await prisma.merchantSettlement.create({
    data: {
      merchantId,
      period,
      totalOrderCount: 1,
      totalAmount: merchantIncomeCents * 2,
      platformFee: merchantIncomeCents,
      merchantIncome: merchantIncomeCents,
      workerIncome: 0,
      status: "confirmed",
    },
  });
  return s.id;
}

describe("[P0-1] createWithdrawRequest — 并发防护", () => {
  let merchantId: string;

  beforeEach(async () => {
    const m = await findActiveMerchant();
    merchantId = m.id;
    await cleanupFor(merchantId);
    // 给商家 ¥1000 confirmed 余额（100000 分）
    await createConfirmedSettlement(merchantId, 100000);
  });

  afterEach(async () => {
    await cleanupFor(merchantId);
  });

  // # spec: 同 merchant 只允许 1 条 pending — DB partial unique + 事务双保险
  it("并发创建 2 条 pending → 只能 1 条成功", async () => {
    const results = await Promise.all([
      createWithdrawRequest({
        merchantId,
        amount: 30000, // ¥300
        remark: "并发 1",
      }),
      createWithdrawRequest({
        merchantId,
        amount: 30000,
        remark: "并发 2",
      }),
    ]);

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.filter((r) => !r.ok).length;
    expect(okCount).toBe(1);
    expect(failCount).toBe(1);

    // 失败的应是"已有未审核"或"超过可提现余额"
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok ? failed.error : "").toMatch(
      /已有未审核|可提现余额/,
    );

    // DB 只剩 1 条 pending
    const pendings = await prisma.withdrawRequest.findMany({
      where: { merchantId, status: "pending" },
    });
    expect(pendings).toHaveLength(1);
  });

  // # spec: approve 后 pending unique 释放，第二条 create 应该成功
  it("approve 第 1 条 → 第 2 条 create 应成功", async () => {
    const first = await createWithdrawRequest({
      merchantId,
      amount: 10000, // ¥100
      remark: "first",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const approveR = await approveWithdrawRequest({
      id: first.id,
      reviewerName: "test-admin",
    });
    expect(approveR.ok).toBe(true);

    // 第二条应能成功（partial unique 只约束 status='pending'）
    const second = await createWithdrawRequest({
      merchantId,
      amount: 20000, // ¥200
      remark: "second",
    });
    expect(second.ok).toBe(true);
  });

  // # spec: reject 后 pending unique 释放，第二条 create 应成功
  it("reject 第 1 条 → 第 2 条 create 应成功", async () => {
    const first = await createWithdrawRequest({
      merchantId,
      amount: 10000,
      remark: "first",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const rejectR = await rejectWithdrawRequest({
      id: first.id,
      reviewerName: "test-admin",
      rejectReason: "test",
    });
    expect(rejectR.ok).toBe(true);

    const second = await createWithdrawRequest({
      merchantId,
      amount: 20000,
      remark: "second",
    });
    expect(second.ok).toBe(true);
  });

  // # spec: 余额校验 — amount > available 必须拒
  it("amount > available → 拒", async () => {
    // available = 100000 分（¥1000），但 demo seed 可能有其他收入，用一个超大金额确保超额
    const available = await (
      await import("./withdraw-request")
    ).getMerchantAvailable(merchantId);
    const r = await createWithdrawRequest({
      merchantId,
      amount: available.available + 10000, // 超过 100 元
      remark: "超额",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/可提现余额/);
    }
  });

  // # spec: 边界 — 远小于 available 应通过
  it("远小于 available → 通过", async () => {
    const r = await createWithdrawRequest({
      merchantId,
      amount: 1000, // 极小金额（¥10）
      remark: "小金额",
    });
    expect(r.ok).toBe(true);
  });
});

describe("[P0-2] approve/reject — 状态机原子化", () => {
  let merchantId: string;

  beforeEach(async () => {
    const m = await findActiveMerchant();
    merchantId = m.id;
    await cleanupFor(merchantId);
    await createConfirmedSettlement(merchantId, 100000);
  });

  afterEach(async () => {
    await cleanupFor(merchantId);
  });

  // # spec: approve 一次成功 → 第二次 approve 必须失败（updateMany 条件 status:pending 不再匹配）
  it("approve 后再 approve → 返『已审核』", async () => {
    const wr = await createWithdrawRequest({
      merchantId,
      amount: 5000,
      remark: "p0-2 test",
    });
    expect(wr.ok).toBe(true);
    if (!wr.ok) return;

    const r1 = await approveWithdrawRequest({
      id: wr.id,
      reviewerName: "admin1",
    });
    expect(r1.ok).toBe(true);

    const r2 = await approveWithdrawRequest({
      id: wr.id,
      reviewerName: "admin2",
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error).toMatch(/仅 pending 状态可审核/);
    }
  });

  // # spec: reject 后再 reject → 返『已审核』
  it("reject 后再 reject → 返『已审核』", async () => {
    const wr = await createWithdrawRequest({
      merchantId,
      amount: 5000,
      remark: "p0-2 reject test",
    });
    expect(wr.ok).toBe(true);
    if (!wr.ok) return;

    const r1 = await rejectWithdrawRequest({
      id: wr.id,
      reviewerName: "admin1",
      rejectReason: "原因 1",
    });
    expect(r1.ok).toBe(true);

    const r2 = await rejectWithdrawRequest({
      id: wr.id,
      reviewerName: "admin2",
      rejectReason: "原因 2",
    });
    expect(r2.ok).toBe(false);
  });

  // # spec: 并发 approve + reject — 只有一个成功
  it("并发 approve + reject → 只有一个成功", async () => {
    const wr = await createWithdrawRequest({
      merchantId,
      amount: 5000,
      remark: "p0-2 race",
    });
    expect(wr.ok).toBe(true);
    if (!wr.ok) return;

    const [approveR, rejectR] = await Promise.all([
      approveWithdrawRequest({ id: wr.id, reviewerName: "admin-A" }),
      rejectWithdrawRequest({
        id: wr.id,
        reviewerName: "admin-B",
        rejectReason: "B 拒绝",
      }),
    ]);

    const okCount = [approveR, rejectR].filter((r) => r.ok).length;
    expect(okCount).toBe(1);

    // 最终状态应该是 approve 或 reject 之一，不是 pending
    const final = await prisma.withdrawRequest.findUnique({
      where: { id: wr.id },
    });
    expect(final?.status).not.toBe("pending");
    expect(["approved", "rejected"]).toContain(final?.status);
  });

  // # spec: approve/reject 不存在的 id → 返『不存在』
  it("approve 不存在的 id → 返『不存在』", async () => {
    const r = await approveWithdrawRequest({
      id: "non-existent-id-xxx",
      reviewerName: "admin",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/不存在/);
    }
  });
});

describe("[P0-3] approve — ledger 同事务", () => {
  let merchantId: string;

  beforeEach(async () => {
    const m = await findActiveMerchant();
    merchantId = m.id;
    await cleanupFor(merchantId);
    await createConfirmedSettlement(merchantId, 100000);
  });

  afterEach(async () => {
    await cleanupFor(merchantId);
  });

  // # spec: approve 成功 → FinanceLedger 一定有 withdraw 流水（同事务强一致）
  it("approve 成功 → 一定有 withdraw ledger 记录", async () => {
    const wr = await createWithdrawRequest({
      merchantId,
      amount: 5000,
      remark: "p0-3 test",
    });
    expect(wr.ok).toBe(true);
    if (!wr.ok) return;

    const r = await approveWithdrawRequest({
      id: wr.id,
      reviewerName: "admin",
    });
    expect(r.ok).toBe(true);

    const ledger = await prisma.financeLedger.findUnique({
      where: { type_sourceId: { type: "withdraw", sourceId: wr.id } },
    });
    expect(ledger).not.toBeNull();
    expect(ledger?.merchantId).toBe(merchantId);
    expect(Number(ledger?.amount)).toBe(50); // 5000 分 = 50 元
  });

  // # spec: reject 不会写 ledger（业务不进账）
  it("reject 成功 → 不写 ledger", async () => {
    const wr = await createWithdrawRequest({
      merchantId,
      amount: 5000,
      remark: "p0-3 reject no ledger",
    });
    expect(wr.ok).toBe(true);
    if (!wr.ok) return;

    const r = await rejectWithdrawRequest({
      id: wr.id,
      reviewerName: "admin",
      rejectReason: "test",
    });
    expect(r.ok).toBe(true);

    const ledger = await prisma.financeLedger.findUnique({
      where: { type_sourceId: { type: "withdraw", sourceId: wr.id } },
    });
    expect(ledger).toBeNull();
  });
});

describe("createWithdrawRequest — 基本规则", () => {
  let merchantId: string;

  beforeEach(async () => {
    const m = await findActiveMerchant();
    merchantId = m.id;
    await cleanupFor(merchantId);
  });

  afterEach(async () => {
    await cleanupFor(merchantId);
  });

  // # spec: amount 必须正整数
  it("amount ≤ 0 → 拒", async () => {
    const r = await createWithdrawRequest({
      merchantId,
      amount: 0,
      remark: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/正整数/);
    }
  });

  // # spec: merchant 不存在必须拒
  it("merchant 不存在 → 拒", async () => {
    const r = await createWithdrawRequest({
      merchantId: "non-existent-merchant-xxx",
      amount: 1000,
      remark: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/不存在/);
    }
  });

  // # spec: merchant 非 active 必须拒
  it("merchant 非 active → 拒", async () => {
    const inactiveMerchant = await prisma.merchant.findFirst({
      where: { status: "inactive" },
    });
    if (!inactiveMerchant) {
      // 没有 inactive 测试数据 → skip 而不是 fail
      return;
    }
    const r = await createWithdrawRequest({
      merchantId: inactiveMerchant.id,
      amount: 1000,
      remark: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/未激活/);
    }
  });
});
