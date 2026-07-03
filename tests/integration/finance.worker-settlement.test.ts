// [任务 17] 财务链路 integration test — T17 worker-settlement 端到端
//
// 起源：本次新功能的端到端 smoke
// 范式：参考 tests/integration/finance.ledger.test.ts（任务 16 迁移）
//
// 覆盖：
// 1. 端到端：自建 2 worker + 各自 completed orders + preview → generate → 列表
// 2. 跨 merchant worker 隔离
// 3. 列表过滤（period / workerId）
//
// # spec: 端到端 — 真实 DB 跑 generate + list
// # spec: 隔离 — 各自 worker 独立汇总
// # spec: 测试数据隔离 — 自建 worker + cleanup 不污染 seed 数据

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import {
  generateAllWorkerSettlements,
  listWorkerSettlements,
} from "@/src/lib/worker-settlement";

describe("T17 worker-settlement — integration smoke", () => {
  let merchantAId: string;
  let merchantBId: string;
  let workerAId: string;
  let workerBId: string;
  const createdOrderIds: string[] = [];
  const createdPreviewIds: string[] = [];

  beforeAll(async () => {
    const rand = Math.random().toString(36).slice(-6);

    // 2 个独立 merchant（不污染 seed 主数据）
    const mA = await prisma.merchant.create({
      data: {
        name: `integration ws A ${rand}`,
        contactName: "测试",
        phone: `139${rand}A`.slice(0, 11),
        inviteCode: `IA${rand}`.slice(0, 8),
        province: "广东",
        city: "深圳",
        district: "南山",
        street: "测试",
        addressDetail: "1号",
        status: "active",
      },
    });
    merchantAId = mA.id;
    const mB = await prisma.merchant.create({
      data: {
        name: `integration ws B ${rand}`,
        contactName: "测试",
        phone: `139${rand}B`.slice(0, 11),
        inviteCode: `IB${rand}`.slice(0, 8),
        province: "广东",
        city: "深圳",
        district: "南山",
        street: "测试",
        addressDetail: "1号",
        status: "active",
      },
    });
    merchantBId = mB.id;

    // 2 个独立 worker（各归属一个 merchant）
    const wA = await prisma.master.create({
      data: {
        name: `WS Worker A ${rand}`,
        phone: `138${rand}A`.slice(0, 11),
        skills: "[]",
        merchantId: merchantAId,
        status: "available",
      },
    });
    workerAId = wA.id;
    const wB = await prisma.master.create({
      data: {
        name: `WS Worker B ${rand}`,
        phone: `138${rand}B`.slice(0, 11),
        skills: "[]",
        merchantId: merchantBId,
        status: "available",
      },
    });
    workerBId = wB.id;

    // 灌 3 笔 SettlementPreview（2099-12）：
    // - workerA × 2 单（orderAmount 10000/20000, workerAmount 7000/14000）
    // - workerB × 1 单（orderAmount 5000, workerAmount 3500）
    const baseDate = new Date("2099-12-15T10:00:00Z");
    const orderData: Array<{
      masterId: string;
      merchantId: string;
      orderAmount: number;
      workerAmount: number;
    }> = [
      {
        masterId: workerAId,
        merchantId: merchantAId,
        orderAmount: 10000,
        workerAmount: 7000,
      },
      {
        masterId: workerAId,
        merchantId: merchantAId,
        orderAmount: 20000,
        workerAmount: 14000,
      },
      {
        masterId: workerBId,
        merchantId: merchantBId,
        orderAmount: 5000,
        workerAmount: 3500,
      },
    ];

    for (const d of orderData) {
      const orderNo = `WSTI${Date.now()}${Math.random().toString(36).slice(-6)}`;
      const order = await prisma.order.create({
        data: {
          id: orderNo,
          customerName: "测试",
          customerPhone: "13900000000",
          province: "广东",
          city: "深圳",
          district: "南山",
          street: "测试",
          addressDetail: "1号",
          address: "广东/深圳/南山/测试 1号",
          scheduledAt: baseDate,
          serviceName: "测试服务",
          amount: d.orderAmount,
          status: "completed",
          master: { connect: { id: d.masterId } },
        },
      });
      createdOrderIds.push(order.id);

      const preview = await prisma.settlementPreview.create({
        data: {
          orderId: order.id,
          merchantId: d.merchantId,
          masterId: d.masterId,
          orderAmount: d.orderAmount,
          platformAmount: 0,
          merchantAmount: d.orderAmount - d.workerAmount,
          workerAmount: d.workerAmount,
          createdAt: baseDate,
        },
      });
      createdPreviewIds.push(preview.id);
    }
  });

  afterAll(async () => {
    // 删除本测试产生的所有数据
    // 1. WorkerSettlement（如果有）
    await prisma.workerSettlement.deleteMany({
      where: { workerId: { in: [workerAId, workerBId] } },
    });
    // 2. SettlementPreview
    if (createdPreviewIds.length > 0) {
      await prisma.settlementPreview.deleteMany({
        where: { id: { in: createdPreviewIds } },
      });
    }
    // 3. Order
    if (createdOrderIds.length > 0) {
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
    }
    // 4. Worker
    await prisma.master.deleteMany({
      where: { id: { in: [workerAId, workerBId] } },
    });
    // 5. Merchant
    await prisma.merchant.deleteMany({
      where: { id: { in: [merchantAId, merchantBId] } },
    });
  });

  // # spec: 端到端 — generate 触发后落表
  it("generateAllWorkerSettlements 写入 workerA + workerB 2099-12 两条", async () => {
    const r = await generateAllWorkerSettlements();
    // 包含我们的 2 个 worker × 1 period = 2 条
    const ourRows = r.details.filter(
      (d) =>
        [workerAId, workerBId].includes(d.workerId) && d.period === "2099-12",
    );
    expect(ourRows.length).toBe(2);
    expect(ourRows.every((d) => d.action === "created")).toBe(true);
  });

  // # spec: 聚合正确 — workerA 2 单聚合
  it("workerA 2099-12: orderCount=2, totalAmount=30000, workerIncome=21000", async () => {
    const list = await listWorkerSettlements({
      workerId: workerAId,
      period: "2099-12",
    });
    expect(list.length).toBe(1);
    const row = list[0]!;
    expect(row.orderCount).toBe(2);
    expect(row.totalAmount).toBe(30000);
    expect(row.workerIncome).toBe(21000);
  });

  // # spec: 聚合正确 — workerB 1 单
  it("workerB 2099-12: orderCount=1, totalAmount=5000, workerIncome=3500", async () => {
    const list = await listWorkerSettlements({
      workerId: workerBId,
      period: "2099-12",
    });
    expect(list.length).toBe(1);
    const row = list[0]!;
    expect(row.orderCount).toBe(1);
    expect(row.totalAmount).toBe(5000);
    expect(row.workerIncome).toBe(3500);
  });

  // # spec: 跨 merchant 隔离 — workerA 数据不混入 workerB 列表
  it("listWorkerSettlements({workerId:A}) 不含 workerB 数据", async () => {
    const listA = await listWorkerSettlements({ workerId: workerAId });
    expect(listA.every((r) => r.workerId === workerAId)).toBe(true);
    expect(listA.some((r) => r.workerId === workerBId)).toBe(false);
  });

  // # spec: include — worker {id, name, phone} 完整
  it("listWorkerSettlements include worker {id, name, phone}", async () => {
    const list = await listWorkerSettlements({
      workerId: workerAId,
      period: "2099-12",
    });
    const row = list[0]!;
    expect(row.worker.id).toBe(workerAId);
    expect(row.worker.name).toContain("WS Worker A");
    expect(row.worker.phone).toMatch(/^138/);
  });

  // # spec: 幂等 — 重复 generate 走 update
  it("重复 generateAllWorkerSettlements 第二次走 updated", async () => {
    const r1 = await generateAllWorkerSettlements();
    const r2 = await generateAllWorkerSettlements();
    const ourA1 = r1.details.find((d) => d.workerId === workerAId);
    const ourA2 = r2.details.find((d) => d.workerId === workerAId);
    expect(ourA1?.action).toBe("updated");
    expect(ourA2?.action).toBe("updated");
  });
});
