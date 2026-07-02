// queries.ts 端到端测试 — listOrdersForPage 过滤（skuCode）
// 覆盖需求 #4：按 SKU 筛选订单

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listOrdersForPage } from "./queries";
import { prisma } from "@/src/lib/db";

const createdIds: string[] = [];
const testSkuA = "TEST-SKU-FILTER-A";
const testSkuB = "TEST-SKU-FILTER-B";

beforeEach(async () => {
  // 清理可能残留的测试数据
  await prisma.order.deleteMany({
    where: { serviceName: { in: ["测试SKU-A订单", "测试SKU-B订单"] } },
  });
  await prisma.serviceSku.deleteMany({
    where: { skuCode: { in: [testSkuA, testSkuB] } },
  });
  await prisma.serviceCategory.deleteMany({
    where: { categoryCode: "TEST-CAT-FILTER" },
  });
});

// # spec: 订单列表 SKU 过滤 = 按 skuCode 只返回该 SKU 订单、未传 skuCode 不过滤、不存在的 SKU 返回 0 条
describe("listOrdersForPage — skuCode 过滤", () => {
  // # spec: 订单列表 SKU 过滤 — 按 skuCode 只返回该 SKU 订单；不存在的 SKU 返回 0 条
  it("按 SKU 过滤只返回该 SKU 的订单", async () => {
    // 1. 创建类目 + 2 个 SKU + 2 个订单
    const cat = await prisma.serviceCategory.create({
      data: { name: "测试类目", categoryCode: "TEST-CAT-FILTER" },
    });
    const skuA = await prisma.serviceSku.create({
      data: {
        skuCode: testSkuA,
        name: "测试SKU-A",
        categoryId: cat.id,
        basePrice: 10000,
        durationMinutes: 60,
        requiredSkills: "[]",
        enabled: true,
      },
    });
    const skuB = await prisma.serviceSku.create({
      data: {
        skuCode: testSkuB,
        name: "测试SKU-B",
        categoryId: cat.id,
        basePrice: 20000,
        durationMinutes: 60,
        requiredSkills: "[]",
        enabled: true,
      },
    });
    const o1 = await prisma.order.create({
      data: {
        id: "TEST-O-A-001",
        customerName: "客户A",
        customerPhone: "13900000001",
        serviceSkuId: skuA.id,
        serviceName: "测试SKU-A订单",
        address: "地址A",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
      },
    });
    createdIds.push(o1.id);
    const o2 = await prisma.order.create({
      data: {
        id: "TEST-O-B-001",
        customerName: "客户B",
        customerPhone: "13900000002",
        serviceSkuId: skuB.id,
        serviceName: "测试SKU-B订单",
        address: "地址B",
        scheduledAt: new Date(),
        amount: 20000,
        status: "pending",
      },
    });
    createdIds.push(o2.id);

    // 2. 无过滤 → 应该看到 2 个测试订单（也可能看到 seed 的，看 SKU 过滤单独验证）
    const all = await listOrdersForPage();
    expect(all.orders.find((o) => o.id === o1.id)).toBeDefined();
    expect(all.orders.find((o) => o.id === o2.id)).toBeDefined();

    // 3. 按 skuCode=A 过滤 → 只看到 o1
    const filterA = await listOrdersForPage({ skuCode: testSkuA });
    expect(filterA.orders.find((o) => o.id === o1.id)).toBeDefined();
    expect(filterA.orders.find((o) => o.id === o2.id)).toBeUndefined();
    expect(filterA.totalCount).toBe(1);

    // 4. 按 skuCode=B 过滤 → 只看到 o2
    const filterB = await listOrdersForPage({ skuCode: testSkuB });
    expect(filterB.orders.find((o) => o.id === o2.id)).toBeDefined();
    expect(filterB.orders.find((o) => o.id === o1.id)).toBeUndefined();
    expect(filterB.totalCount).toBe(1);

    // 5. 不存在的 skuCode → 0 个
    const empty = await listOrdersForPage({ skuCode: "NON-EXISTENT-SKU" });
    expect(empty.orders).toHaveLength(0);
    expect(empty.totalCount).toBe(0);
  });

  // # documents current behavior: 不传 skuCode 不过滤，返回全量订单
  it("skuCode 不传 → 不应用过滤（全量订单）", async () => {
    const all = await listOrdersForPage();
    expect(all.totalCount).toBeGreaterThan(0);
  });
});

// # spec: 订单列表时间过滤 + 分页 = 按 createdAt/scheduledAt 时间范围、dateTo 不含次日 0 点、page/pageSize 控制分页且不重复
describe("listOrdersForPage — 时间范围 + 分页", () => {
  // # spec: 订单列表时间过滤 — dateField=createdAt 时按 createdAt 时间范围过滤
  it("按 createdAt 时间范围过滤（锚定第一条订单的真实 createdAt）", async () => {
    // # documents current behavior: 用 DB 中第一条订单的 createdAt 作为时间锚点
    // 避免依赖"seed 是今天创建的"——跨日/CI 重跑 seed 时本地 0:00 与 seed UTC 不一致会假阳性失败
    const first = await prisma.order.findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (!first) {
      // 没有订单时这个 it 没意义，跳过
      return;
    }
    const anchor = new Date(first.createdAt);
    anchor.setHours(0, 0, 0, 0);
    const nextDay = new Date(anchor);
    nextDay.setDate(nextDay.getDate() + 1);
    const r = await listOrdersForPage({
      dateFrom: anchor,
      dateTo: anchor,
      dateField: "createdAt",
      page: 1,
      pageSize: 100,
    });
    expect(r.totalCount).toBeGreaterThan(0);
  });

  // # spec: 订单列表时间过滤 — 远古日期范围匹配不到任何订单时 totalCount=0
  it("按 createdAt 时间范围（远古）→ 应该 0", async () => {
    const dateFrom = new Date("2020-01-01T00:00:00");
    const dateTo = new Date("2020-01-01T00:00:00");
    const r = await listOrdersForPage({
      dateFrom,
      dateTo,
      dateField: "createdAt",
      page: 1,
      pageSize: 100,
    });
    expect(r.totalCount).toBe(0);
  });

  // # spec: 订单列表时间过滤 — dateField=scheduledAt 时按预约时间范围过滤
  // [v0.9.2] 改用 demo seed 真实日期范围（6/26 + 6/29）
  it("按 scheduledAt 时间范围过滤", async () => {
    // O20260626002 预约 2026-06-26，O20260626001 预约 2026-06-26
    // O20260629011 预约 2026-06-29 — 应该匹配 6/26-6/29 范围
    const dateFrom = new Date("2026-06-26T00:00:00");
    const dateTo = new Date("2026-06-29T00:00:00");
    const r = await listOrdersForPage({
      dateFrom,
      dateTo,
      dateField: "scheduledAt",
      page: 1,
      pageSize: 100,
    });
    expect(r.orders.find((o) => o.id === "O20260626002")).toBeDefined();
    expect(r.orders.find((o) => o.id === "O20260626001")).toBeDefined();
    expect(r.orders.find((o) => o.id === "O20260629011")).toBeDefined();
  });

  // # spec: 订单列表时间边界 — dateTo 是「含当天 < 次日 00:00」不包含次日
  // [v0.9.2] 用 6/27 测试「只含当天」
  it("dateTo 不含当天（< 次日 00:00）", async () => {
    // dateTo = 2026-06-27 → 只包含 2026-06-27 当天
    // demo seed 有 2 条 6/27 completed 订单
    const dateFrom = new Date("2026-06-27T00:00:00");
    const dateTo = new Date("2026-06-27T00:00:00");
    const r = await listOrdersForPage({
      dateFrom,
      dateTo,
      dateField: "scheduledAt",
      page: 1,
      pageSize: 100,
    });
    // 2026-06-26 不该出现
    expect(r.orders.find((o) => o.id === "O20260626002")).toBeUndefined();
    // 2026-06-29 不该出现
    expect(r.orders.find((o) => o.id === "O20260629011")).toBeUndefined();
    expect(r.orders.find((o) => o.id === "O20260627001")).toBeDefined();
    expect(r.orders.find((o) => o.id === "O20260627002")).toBeDefined();
    expect(r.totalCount).toBe(2);
  });

  // # spec: 订单列表分页 — page + pageSize 控制分页且不同页 ID 不重复
  it("分页 page + pageSize", async () => {
    const r1 = await listOrdersForPage({ page: 1, pageSize: 2 });
    expect(r1.orders.length).toBeLessThanOrEqual(2);
    expect(r1.totalCount).toBeGreaterThanOrEqual(r1.orders.length);

    const r2 = await listOrdersForPage({ page: 2, pageSize: 2 });
    expect(r2.orders.length).toBeLessThanOrEqual(2);
    // 不同页的 ID 应该不重复
    const r1Ids = new Set(r1.orders.map((o) => o.id));
    r2.orders.forEach((o) => expect(r1Ids.has(o.id)).toBe(false));
  });
});

// 清理 — vitest 用 worker 跑，process.on("exit") 不可靠，用 afterAll
afterAll(async () => {
  try {
    for (const id of createdIds) {
      await prisma.order.deleteMany({ where: { id } });
    }
    await prisma.serviceSku.deleteMany({
      where: { skuCode: { in: [testSkuA, testSkuB] } },
    });
    await prisma.serviceCategory.deleteMany({
      where: { categoryCode: "TEST-CAT-FILTER" },
    });
    await prisma.$disconnect();
  } catch {}
});
