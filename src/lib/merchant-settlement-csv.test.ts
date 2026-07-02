// CSV 导出过滤规则测试 — 连真实 SQLite
// 覆盖 [F1-1]：只导出 status ∈ (confirmed, archived) 的 (merchantId, period) 对应的 SettlementPreview
//
// 设计：
// - 建一个 active merchant
// - 建 2 笔 SettlementPreview：1 笔对应 archived settlement、1 笔对应 pending settlement（同 merchant）
// - buildAllSettlementsCsv → 应只包含 archived 那笔

import { afterEach, describe, expect, it } from "vitest";
import { buildAllSettlementsCsv } from "./merchant-settlement-csv";
import { prisma } from "@/src/lib/db";

const createdIds = {
  orders: [] as string[],
  merchants: [] as string[],
  masters: [] as string[],
  settlements: [] as string[],
  previews: [] as string[],
};

async function cleanup() {
  if (createdIds.previews.length > 0) {
    await prisma.settlementPreview.deleteMany({
      where: { id: { in: createdIds.previews } },
    });
    createdIds.previews.length = 0;
  }
  if (createdIds.settlements.length > 0) {
    await prisma.merchantSettlement.deleteMany({
      where: { id: { in: createdIds.settlements } },
    });
    createdIds.settlements.length = 0;
  }
  if (createdIds.orders.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: createdIds.orders } } });
    createdIds.orders.length = 0;
  }
  if (createdIds.masters.length > 0) {
    await prisma.master.deleteMany({
      where: { id: { in: createdIds.masters } },
    });
    createdIds.masters.length = 0;
  }
  if (createdIds.merchants.length > 0) {
    await prisma.merchant.deleteMany({
      where: { id: { in: createdIds.merchants } },
    });
    createdIds.merchants.length = 0;
  }
}

describe("buildAllSettlementsCsv — [F1-1] 严格过滤", () => {
  afterEach(cleanup);

  // # spec: CSV 导出规则 = 只导出 status ∈ (confirmed, archived) 的 (merchant, period) 对应的 SettlementPreview
  it("pending settlement 对应的 preview 不导出", async () => {
    // 建独立 merchant（不污染 seed）
    const merchant = await prisma.merchant.create({
      data: {
        name: "CSV 测试商家",
        contactName: "测试",
        phone: "13900099999",
        inviteCode: `CSV${Date.now()}`.slice(0, 8),
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        street: "测试街",
        addressDetail: "1号",
        status: "active",
      },
    });
    createdIds.merchants.push(merchant.id);

    // 2 笔 preview：1 笔配 archived，1 笔配 pending（merchant 同、period 不同）
    // period 必须 YYYY-MM 格式 — preview 的 createdAt 月份必须与 settlement.period 一致
    const archivedPeriod = "2099-06";
    const pendingPeriod = "2098-06";

    const archivedSettle = await prisma.merchantSettlement.create({
      data: {
        merchantId: merchant.id,
        period: archivedPeriod,
        totalOrderCount: 1,
        totalAmount: 10000,
        platformFee: 1000,
        merchantIncome: 9000,
        workerIncome: 0,
        status: "archived",
      },
    });
    createdIds.settlements.push(archivedSettle.id);

    const pendingSettle = await prisma.merchantSettlement.create({
      data: {
        merchantId: merchant.id,
        period: pendingPeriod,
        totalOrderCount: 1,
        totalAmount: 5000,
        platformFee: 500,
        merchantIncome: 4500,
        workerIncome: 0,
        status: "pending",
      },
    });
    createdIds.settlements.push(pendingSettle.id);

    // 建 master（FK SettlementPreview.masterId）
    const master = await prisma.master.create({
      data: {
        name: "CSV 测试师傅",
        phone: `1390009${Date.now().toString().slice(-5)}`,
        skills: "[]",
        merchantId: merchant.id,
      },
    });
    createdIds.masters.push(master.id);

    // 建 2 笔 order（FK SettlementPreview.orderId）
    const orderArchived = await prisma.order.create({
      data: {
        id: `O_CSV_A_${Date.now()}`.slice(0, 24),
        customerName: "客户A",
        address: "测试地址 A",
        serviceName: "测试服务 A",
        scheduledAt: new Date("2099-06-15T10:00:00Z"),
        amount: 10000,
        status: "completed",
        masterId: master.id,
      },
    });
    createdIds.orders.push(orderArchived.id);

    const orderPending = await prisma.order.create({
      data: {
        id: `O_CSV_P_${Date.now()}`.slice(0, 24),
        customerName: "客户P",
        address: "测试地址 P",
        serviceName: "测试服务 P",
        scheduledAt: new Date("2098-06-15T10:00:00Z"),
        amount: 5000,
        status: "completed",
        masterId: master.id,
      },
    });
    createdIds.orders.push(orderPending.id);

    // 2 笔 preview（merchant 同；period 由 createdAt 月份决定 — 设为不同月）
    // 注意：period 必须是 YYYY-MM 才能被 formatPeriod 解析
    const archivedPreview = await prisma.settlementPreview.create({
      data: {
        orderId: orderArchived.id,
        merchantId: merchant.id,
        masterId: master.id,
        orderAmount: 10000,
        platformAmount: 1000,
        merchantAmount: 9000,
        workerAmount: 0,
        status: "generated",
        createdAt: new Date(`2099-06-15T10:00:00Z`),
      },
    });
    createdIds.previews.push(archivedPreview.id);

    const pendingPreview = await prisma.settlementPreview.create({
      data: {
        orderId: orderPending.id,
        merchantId: merchant.id,
        masterId: master.id,
        orderAmount: 5000,
        platformAmount: 500,
        merchantAmount: 4500,
        workerAmount: 0,
        status: "generated",
        createdAt: new Date(`2098-06-15T10:00:00Z`),
      },
    });
    createdIds.previews.push(pendingPreview.id);

    const csv = await buildAllSettlementsCsv();

    // archived preview 应收录（按 amount 10000 找）
    expect(csv).toContain("100.00");
    // pending preview 金额 5000 不应收录
    expect(csv).not.toContain("50.00");
    // CSV 头部必须有
    expect(csv).toContain("订单ID");
    // 含 BOM
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
});
