// [任务 T2-1] worker-withdraw-request 业务规则 + 并发 + 状态机测试
//
// 覆盖：
// - P0-1: 同 worker 并发创建 2 条 pending → 只能 1 条成功（DB partial unique + 事务兜底）
// - P0-1: approve/reject 后再 create 第二条 pending → 成功
// - P0-2: approve 后再 approve → 返"已审核"
// - P0-2: reject 后再 reject → 返"已审核"
// - P0-2: 并发 approve + reject → 只有一个成功
// - 基本规则：amount ≤ 0 / worker 不存在 / 超过 available
// - **不写 FinanceLedger**（approve 成功不应有 ledger 记录）

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import {
  approveWorkerWithdrawRequest,
  createWorkerWithdrawRequest,
  getWorkerAvailable,
  rejectWorkerWithdrawRequest,
} from "./worker-withdraw-request";

async function findWorker(): Promise<{ id: string; name: string }> {
  const w = await prisma.master.findFirst();
  if (!w) throw new Error("seed 没建 master");
  return { id: w.id, name: w.name };
}

async function cleanupFor(workerId: string) {
  await prisma.workerWithdrawRequest.deleteMany({ where: { workerId } });
}

async function createWorkerIncome(
  workerId: string,
  workerIncomeCents: number,
): Promise<string> {
  // 用 2098- 前缀避免与 worker-settlement.test.ts 的 2099- 冲突
  const period = `2098-12-${Math.floor(Math.random() * 100000)}`;
  const ws = await prisma.workerSettlement.create({
    data: {
      workerId,
      period,
      orderCount: 1,
      totalAmount: workerIncomeCents * 2,
      workerIncome: workerIncomeCents,
    },
  });
  return ws.id;
}

describe("[P0-1] createWorkerWithdrawRequest — 并发防护", () => {
  let workerId: string;

  beforeEach(async () => {
    const w = await findWorker();
    workerId = w.id;
    await cleanupFor(workerId);
    // 给师傅 ¥1000 workerIncome（100000 分）
    await createWorkerIncome(workerId, 100000);
  });

  afterEach(async () => {
    await cleanupFor(workerId);
  });

  // # spec: 同 worker 只允许 1 条 pending — DB partial unique + 事务双保险
  it("并发创建 2 条 pending → 只能 1 条成功", async () => {
    const results = await Promise.all([
      createWorkerWithdrawRequest({
        workerId,
        amount: 30000, // ¥300
        remark: "并发 1",
      }),
      createWorkerWithdrawRequest({
        workerId,
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
    const pendings = await prisma.workerWithdrawRequest.findMany({
      where: { workerId, status: "pending" },
    });
    expect(pendings).toHaveLength(1);
  });

  // # spec: approve 后 pending unique 释放，第二条 create 应该成功
  it("approve 第 1 条 → 第 2 条 create 应成功", async () => {
    const first = await createWorkerWithdrawRequest({
      workerId,
      amount: 10000,
      remark: "first",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const approveR = await approveWorkerWithdrawRequest({
      id: first.id,
      reviewerName: "test-admin",
    });
    expect(approveR.ok).toBe(true);

    const second = await createWorkerWithdrawRequest({
      workerId,
      amount: 20000,
      remark: "second",
    });
    expect(second.ok).toBe(true);
  });

  // # spec: reject 后 pending unique 释放
  it("reject 第 1 条 → 第 2 条 create 应成功", async () => {
    const first = await createWorkerWithdrawRequest({
      workerId,
      amount: 10000,
      remark: "first",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const rejectR = await rejectWorkerWithdrawRequest({
      id: first.id,
      reviewerName: "test-admin",
      rejectReason: "test",
    });
    expect(rejectR.ok).toBe(true);

    const second = await createWorkerWithdrawRequest({
      workerId,
      amount: 20000,
      remark: "second",
    });
    expect(second.ok).toBe(true);
  });

  // # spec: 余额校验
  it("amount > available → 拒", async () => {
    const available = await getWorkerAvailable(workerId);
    const r = await createWorkerWithdrawRequest({
      workerId,
      amount: available.available + 10000,
      remark: "超额",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/可提现余额/);
    }
  });

  // # spec: 申请金额 < available → 创建成功 (基本合法路径)
  it("远小于 available → 通过", async () => {
    const r = await createWorkerWithdrawRequest({
      workerId,
      amount: 1000,
      remark: "小金额",
    });
    expect(r.ok).toBe(true);
  });
});

describe("[P0-2] approve/reject — 状态机原子化", () => {
  let workerId: string;

  beforeEach(async () => {
    const w = await findWorker();
    workerId = w.id;
    await cleanupFor(workerId);
    await createWorkerIncome(workerId, 100000);
  });

  afterEach(async () => {
    await cleanupFor(workerId);
  });

  // # spec: approve 一次成功 → 第二次 approve 必须失败
  it("approve 后再 approve → 返『已审核』", async () => {
    const wr = await createWorkerWithdrawRequest({
      workerId,
      amount: 5000,
      remark: "p0-2 test",
    });
    expect(wr.ok).toBe(true);
    if (!wr.ok) return;

    const r1 = await approveWorkerWithdrawRequest({
      id: wr.id,
      reviewerName: "admin1",
    });
    expect(r1.ok).toBe(true);

    const r2 = await approveWorkerWithdrawRequest({
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
    const wr = await createWorkerWithdrawRequest({
      workerId,
      amount: 5000,
      remark: "p0-2 reject test",
    });
    expect(wr.ok).toBe(true);
    if (!wr.ok) return;

    const r1 = await rejectWorkerWithdrawRequest({
      id: wr.id,
      reviewerName: "admin1",
      rejectReason: "原因 1",
    });
    expect(r1.ok).toBe(true);

    const r2 = await rejectWorkerWithdrawRequest({
      id: wr.id,
      reviewerName: "admin2",
      rejectReason: "原因 2",
    });
    expect(r2.ok).toBe(false);
  });

  // # spec: 并发 approve + reject — 只有一个成功
  it("并发 approve + reject → 只有一个成功", async () => {
    const wr = await createWorkerWithdrawRequest({
      workerId,
      amount: 5000,
      remark: "p0-2 race",
    });
    expect(wr.ok).toBe(true);
    if (!wr.ok) return;

    const [approveR, rejectR] = await Promise.all([
      approveWorkerWithdrawRequest({ id: wr.id, reviewerName: "admin-A" }),
      rejectWorkerWithdrawRequest({
        id: wr.id,
        reviewerName: "admin-B",
        rejectReason: "B 拒绝",
      }),
    ]);

    const okCount = [approveR, rejectR].filter((r) => r.ok).length;
    expect(okCount).toBe(1);

    const final = await prisma.workerWithdrawRequest.findUnique({
      where: { id: wr.id },
    });
    expect(final?.status).not.toBe("pending");
    expect(["approved", "rejected"]).toContain(final?.status);
  });

  // # spec: approve 不存在的 id → 返错误 (防误操作)
  it("approve 不存在的 id → 返『不存在』", async () => {
    const r = await approveWorkerWithdrawRequest({
      id: "non-existent-id-xxx",
      reviewerName: "admin",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/不存在/);
    }
  });
});

describe("[任务边界] 不写 FinanceLedger", () => {
  let workerId: string;

  beforeEach(async () => {
    const w = await findWorker();
    workerId = w.id;
    await cleanupFor(workerId);
    await createWorkerIncome(workerId, 100000);
  });

  afterEach(async () => {
    await cleanupFor(workerId);
  });

  // # spec: approve 成功不应写任何 FinanceLedger 流水（师傅端无 payout 流程）
  it("approve 成功 → 不写 FinanceLedger", async () => {
    const wr = await createWorkerWithdrawRequest({
      workerId,
      amount: 5000,
      remark: "no-ledger test",
    });
    expect(wr.ok).toBe(true);
    if (!wr.ok) return;

    const r = await approveWorkerWithdrawRequest({
      id: wr.id,
      reviewerName: "admin",
    });
    expect(r.ok).toBe(true);

    // 师傅维度没有 merchantId，FinanceLedger 不会写；这里用 count 兜底
    // 即使有 schema mismatch，也应该 0 条
    const total = await prisma.financeLedger.count();
    // 只校验：本测试新增的 wr.id 没有作为 sourceId 出现
    const linked = await prisma.financeLedger.findFirst({
      where: { sourceId: wr.id },
    });
    expect(linked).toBeNull();
    // 避免 unused
    expect(total).toBeGreaterThanOrEqual(0);
  });
});

describe("createWorkerWithdrawRequest — 基本规则", () => {
  let workerId: string;

  beforeEach(async () => {
    const w = await findWorker();
    workerId = w.id;
    await cleanupFor(workerId);
  });

  afterEach(async () => {
    await cleanupFor(workerId);
  });

  // # spec: amount 必须正整数
  it("amount ≤ 0 → 拒", async () => {
    const r = await createWorkerWithdrawRequest({
      workerId,
      amount: 0,
      remark: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/正整数/);
    }
  });

  // # spec: worker 不存在必须拒
  it("worker 不存在 → 拒", async () => {
    const r = await createWorkerWithdrawRequest({
      workerId: "non-existent-worker-xxx",
      amount: 1000,
      remark: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/不存在/);
    }
  });
});
