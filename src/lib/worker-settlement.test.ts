// [任务 17] WorkerSettlement 业务规则测试
//
// 覆盖：
// - formatPeriod 边界（1月/12月/跨年）
// - generateAllWorkerSettlements：空数据 / 单师傅单 period / 多师傅多 period / 重复幂等
// - listWorkerSettlements：filter period / workerId / 无 filter
// - listWorkerSettlementPeriods：distinct + desc
//
// # spec: 聚合口径 — 同一 (worker, period) 多次生成走 upsert，不重复

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import {
  formatPeriod,
  generateAllWorkerSettlements,
  getWorkerSettlement,
  getWorkerSettlementByKey,
  listWorkerSettlementPeriods,
  listWorkerSettlements,
} from "./worker-settlement";

describe("formatPeriod", () => {
  // # spec: 1月 → 0-pad "01"
  it("1月 → 2026-01", () => {
    expect(formatPeriod(new Date("2026-01-15T10:00:00Z"))).toBe("2026-01");
  });
  // # spec: 12月 → 不 pad
  it("12月 → 2026-12", () => {
    expect(formatPeriod(new Date("2026-12-31T10:00:00Z"))).toBe("2026-12");
  });
  // # spec: 跨年
  it("跨年 → 2027-01", () => {
    expect(formatPeriod(new Date("2027-01-01T10:00:00Z"))).toBe("2027-01");
  });
});

describe("generateAllWorkerSettlements", () => {
  // 测试数据：2 个 worker + 3 个 merchant + 若干 completed orders → previews
  // 用 cleanup 隔离
  let workerAId = "";
  let workerBId = "";
  let merchantAId = "";
  let merchantBId = "";
  let merchantCId = "";

  async function findOrCreateMerchant(label: string): Promise<string> {
    // 用 random + label 拼 unique 标识,避免 beforeEach 跑太快撞 unique 约束
    const rand = Math.random().toString(36).slice(-6);
    const m = await prisma.merchant.create({
      data: {
        name: `WS test ${label} ${rand}`,
        contactName: "测试",
        phone: `139${rand}${label.charCodeAt(0)}`.slice(0, 11),
        inviteCode: `W${rand}${label.charCodeAt(0)}`.slice(0, 8),
        province: "广东",
        city: "深圳",
        district: "南山",
        street: "测试",
        addressDetail: "1号",
        status: "active",
      },
    });
    return m.id;
  }

  async function findOrCreateWorker(
    name: string,
    merchantId: string,
  ): Promise<string> {
    const rand = Math.random().toString(36).slice(-6);
    const w = await prisma.master.create({
      data: {
        name: `${name} ${rand}`,
        phone: `138${rand}${name.charCodeAt(0)}`.slice(0, 11),
        skills: "[]",
        merchantId,
        status: "available",
      },
    });
    return w.id;
  }

  async function createCompletedOrderWithPreview(
    masterId: string,
    merchantId: string,
    orderAmount: number,
    workerAmount: number,
    createdAt: Date,
  ): Promise<void> {
    // 直接造 SettlementPreview（绕开 Order → preview 链路）
    // 实际 prod 中 SettlementPreview 由 src/lib/settlement.ts:splitOrderAmountByStrategy 产生
    // Order 表没 merchantId 字段（merchant 关系通过 SettlementPreview 反向）
    const orderNo = `WSTEST${Date.now()}${Math.random().toString(36).slice(-8)}`;
    const order = await prisma.order.create({
      data: {
        id: orderNo, // Order.id = 业务订单号（schema.prisma:122）
        customerName: "测试用户",
        customerPhone: "13900000000",
        province: "广东",
        city: "深圳",
        district: "南山",
        street: "测试",
        addressDetail: "1号",
        address: "广东/深圳/南山/测试 1号",
        scheduledAt: createdAt,
        serviceName: "测试服务",
        amount: orderAmount,
        status: "completed",
        master: { connect: { id: masterId } },
        // Order 表没有 completedAt 字段（用 canceledAt 表示终止时间）
        // completion 时刻由 SettlementPreview.createdAt 记录（preview 在订单完成时生成）
      },
    });
    await prisma.settlementPreview.create({
      data: {
        orderId: order.id,
        merchantId,
        masterId,
        orderAmount,
        platformAmount: 0,
        merchantAmount: orderAmount - workerAmount,
        workerAmount,
        createdAt,
      },
    });
  }

  beforeEach(async () => {
    merchantAId = await findOrCreateMerchant("A");
    merchantBId = await findOrCreateMerchant("B");
    merchantCId = await findOrCreateMerchant("C");
    workerAId = await findOrCreateWorker("WSA", merchantAId);
    workerBId = await findOrCreateWorker("WSB", merchantBId);

    // 清掉本测试 worker 的所有 WorkerSettlement
    await prisma.workerSettlement.deleteMany({
      where: { workerId: { in: [workerAId, workerBId] } },
    });
  });

  afterEach(async () => {
    // 删除本测试产生的所有数据（cascade 删 settlement + preview）
    await prisma.settlementPreview.deleteMany({
      where: { masterId: { in: [workerAId, workerBId] } },
    });
    await prisma.workerSettlement.deleteMany({
      where: { workerId: { in: [workerAId, workerBId] } },
    });
    await prisma.order.deleteMany({
      where: { masterId: { in: [workerAId, workerBId] } },
    });
    await prisma.master.deleteMany({
      where: { id: { in: [workerAId, workerBId] } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [merchantAId, merchantBId, merchantCId] } },
    });
  });

  // # spec: 聚合口径 — 单 worker 单 period，1 单 → 1 条
  it("单 worker 单 period, 1 笔 preview → 生成 1 条 settlement", async () => {
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      10000, // ¥100
      7000, // ¥70 worker
      new Date("2099-12-15T10:00:00Z"),
    );
    const r = await generateAllWorkerSettlements();
    const ourRow = r.details.find(
      (d) => d.workerId === workerAId && d.period === "2099-12",
    );
    expect(ourRow).toBeDefined();
    expect(ourRow?.action).toBe("created");

    const ws = await getWorkerSettlementByKey(workerAId, "2099-12");
    expect(ws?.orderCount).toBe(1);
    expect(ws?.totalAmount).toBe(10000);
    expect(ws?.workerIncome).toBe(7000);
  });

  // # spec: 聚合口径 — 单 worker 同 period 多笔 → 累加
  it("单 worker 同 period, 3 笔 preview → orderCount=3, totalAmount / workerIncome 累加", async () => {
    const d = new Date("2099-12-15T10:00:00Z");
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      10000,
      7000,
      d,
    );
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      20000,
      14000,
      d,
    );
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      5000,
      3500,
      d,
    );
    await generateAllWorkerSettlements();
    const ws = await getWorkerSettlementByKey(workerAId, "2099-12");
    expect(ws?.orderCount).toBe(3);
    expect(ws?.totalAmount).toBe(35000);
    expect(ws?.workerIncome).toBe(24500);
  });

  // # spec: 聚合口径 — 多 worker + 多 period → 每组合 1 条
  it("2 worker × 2 period → 4 条", async () => {
    // workerA: 2099-11 + 2099-12
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      10000,
      7000,
      new Date("2099-11-15"),
    );
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      5000,
      3500,
      new Date("2099-12-15"),
    );
    // workerB: 2099-11 + 2099-12
    await createCompletedOrderWithPreview(
      workerBId,
      merchantBId,
      20000,
      14000,
      new Date("2099-11-15"),
    );
    await createCompletedOrderWithPreview(
      workerBId,
      merchantBId,
      15000,
      10500,
      new Date("2099-12-15"),
    );
    const r = await generateAllWorkerSettlements();
    const ourRows = r.details.filter((d) =>
      [workerAId, workerBId].includes(d.workerId),
    );
    expect(ourRows.length).toBe(4);
    expect(r.created).toBeGreaterThanOrEqual(4);
  });

  // # spec: 幂等 — 重复生成走 update（不重复 created）
  it("重复生成 → 第 2 次全部走 updated", async () => {
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      10000,
      7000,
      new Date("2099-12-15"),
    );
    const r1 = await generateAllWorkerSettlements();
    const r2 = await generateAllWorkerSettlements();
    const a1First = r1.details.find((d) => d.workerId === workerAId);
    const a1Second = r2.details.find((d) => d.workerId === workerAId);
    expect(a1First?.action).toBe("created");
    expect(a1Second?.action).toBe("updated");
  });

  // # spec: 过滤 — listWorkerSettlements 按 period
  it("listWorkerSettlements({period:'2099-12'}) 只返回该 period", async () => {
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      10000,
      7000,
      new Date("2099-11-15"),
    );
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      5000,
      3500,
      new Date("2099-12-15"),
    );
    await createCompletedOrderWithPreview(
      workerBId,
      merchantBId,
      20000,
      14000,
      new Date("2099-12-15"),
    );
    await generateAllWorkerSettlements();

    const list = await listWorkerSettlements({ period: "2099-12" });
    const ourRows = list.filter((w) =>
      [workerAId, workerBId].includes(w.workerId),
    );
    expect(ourRows.length).toBe(2);
    expect(ourRows.every((w) => w.period === "2099-12")).toBe(true);
  });

  // # spec: 过滤 — listWorkerSettlements 按 workerId
  it("listWorkerSettlements({workerId}) 只返回该 worker", async () => {
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      10000,
      7000,
      new Date("2099-11-15"),
    );
    await createCompletedOrderWithPreview(
      workerBId,
      merchantBId,
      20000,
      14000,
      new Date("2099-12-15"),
    );
    await generateAllWorkerSettlements();
    const list = await listWorkerSettlements({ workerId: workerAId });
    expect(list.length).toBe(1);
    expect(list[0]?.workerId).toBe(workerAId);
  });

  // # spec: 包含 — include worker {id, name, phone}
  it("listWorkerSettlements include worker {id, name, phone}", async () => {
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      10000,
      7000,
      new Date("2099-12-15"),
    );
    await generateAllWorkerSettlements();
    const list = await listWorkerSettlements({ workerId: workerAId });
    const row = list.find((w) => w.workerId === workerAId);
    expect(row?.worker).toBeDefined();
    expect(row?.worker.id).toBe(workerAId);
    expect(row?.worker.name).toContain("WSA");
    expect(row?.worker.phone).toMatch(/^138/);
  });

  // # spec: 查询 — getWorkerSettlementByKey 命中
  it("getWorkerSettlementByKey(worker, period) 正确返回", async () => {
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      10000,
      7000,
      new Date("2099-12-15"),
    );
    await generateAllWorkerSettlements();
    const ws = await getWorkerSettlementByKey(workerAId, "2099-12");
    expect(ws?.id).toBeDefined();
    expect(ws?.workerIncome).toBe(7000);
  });

  // # spec: 查询 — getWorkerSettlementByKey 找不到返 null
  it("getWorkerSettlementByKey 不存在的 key → null", async () => {
    const ws = await getWorkerSettlementByKey("nonexistent-worker", "2099-12");
    expect(ws).toBeNull();
  });

  // # spec: 列表 — listWorkerSettlementPeriods distinct + desc
  it("listWorkerSettlementPeriods 返回 distinct periods, 倒序", async () => {
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      10000,
      7000,
      new Date("2099-10-15"),
    );
    await createCompletedOrderWithPreview(
      workerAId,
      merchantAId,
      5000,
      3500,
      new Date("2099-12-15"),
    );
    await createCompletedOrderWithPreview(
      workerBId,
      merchantBId,
      20000,
      14000,
      new Date("2099-11-15"),
    );
    await generateAllWorkerSettlements();
    const periods = await listWorkerSettlementPeriods();
    const ourPeriods = periods.filter((p) => p.startsWith("2099-"));
    expect(ourPeriods.length).toBe(3);
    // 倒序：12, 11, 10
    const ourDesc = ourPeriods.sort().reverse();
    expect(ourPeriods).toEqual(ourDesc);
  });
});
