// 订单号生成 + 撞号重试的测试。
// buildOrderId 是纯函数；generateNextOrderId 走真实 DB。

import { afterEach, describe, expect, it } from "vitest";
import { buildOrderId, createOrder, generateNextOrderId } from "./orders";
import { prisma } from "@/src/lib/db";

// # spec: 订单号格式 = O + YYYYMMDD + 4 位当日序号的拼装规则，月日单位数补 0
describe("buildOrderId（纯函数）", () => {
  // # spec: 订单号格式 — O + YYYYMMDD + 4 位当日序号，超过 4 位不截断
  it("格式化：O + YYYYMMDD + 4 位 seq", () => {
    const d = new Date(2026, 5, 24, 10, 0, 0); // 2026-06-24
    expect(buildOrderId(d, 1)).toBe("O202606240001");
    expect(buildOrderId(d, 42)).toBe("O202606240042");
    expect(buildOrderId(d, 9999)).toBe("O202606249999"); // 9999 已是 4 位
    expect(buildOrderId(d, 12345)).toBe("O2026062412345"); // 超过 4 位也不截断
  });

  // # spec: 订单号格式 — 月日单位数补 0（避免 2026-1-5 → 202615）
  it("月日单位数补 0", () => {
    const d = new Date(2026, 0, 5, 10, 0, 0); // 2026-01-05
    expect(buildOrderId(d, 1)).toBe("O202601050001");
  });
});

// # spec: 当日下一个候选订单号 = O{YYYYMMDD}{4 位 seq}，按当日已有订单最大值递增
describe("generateNextOrderId（真实 DB）", () => {
  // # spec: 当日候选号 — generateNextOrderId 返回 O{YYYYMMDD}{4 位} 当日最大号 + 1
  it("返回形如 O{YYYYMMDD}{4 位} 的当日候选号", async () => {
    const id = await generateNextOrderId();
    // 只断言格式（不硬编码 0001 — 跟其它测试的创建顺序有关）
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayPrefix = `O${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
    expect(id.startsWith(todayPrefix)).toBe(true);
    expect(id.length).toBe(todayPrefix.length + 4);
  });
});

// # spec: 订单号撞号时自动重试到下一号，createOrder 遇到 P2002 unique 冲突应重新 generateNextOrderId 并落库成功
describe("createOrder 撞号重试", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await prisma.order.deleteMany({ where: { id } });
    }
  });

  // # spec: 订单号撞号重试 — 候选号被占时 createOrder 自动重试 +1 号并落库
  it("预先占位「下一个候选号」→ createOrder 应该自动重试到 +1 的号", async () => {
    // 1. 先调一次拿到当日「下一个候选号」
    const collisionId = await generateNextOrderId();

    // 2. 手工把 collisionId 占位（直接 create 一个同名订单占住）
    await prisma.order.create({
      data: {
        id: collisionId,
        customerName: "占位",
        customerPhone: "13900000000",
        serviceSkuId: null,
        serviceName: "占位",
        address: "测试",
        scheduledAt: new Date(),
        amount: 0,
        status: "cancelled",
      },
    });
    createdIds.push(collisionId);

    // 3. 现在调 createOrder — 它会先 generateNextOrderId 拿到 collisionId（被占了）
    //    create 报 P2002 → 重试 → 重新 generateNextOrderId → 拿到 +1 的号
    const r = await createOrder({
      customerName: "测试",
      customerPhone: "13900000001",
      address: "上海市",
      province: "上海市",
      city: "上海市",
      district: "浦东新区",
      street: "世纪大道",
      addressDetail: "100 号",
      skuCode: "CLEAN-DAILY-2H",
      amount: 158,
      scheduledAt: new Date("2026-06-26T10:00:00"),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdIds.push(r.orderId);

    // 4. 验证：创建的订单号 != 撞号的号，应该是 +1
    expect(r.orderId).not.toBe(collisionId);

    // 5. 验证：DB 里 collisionId 和 r.orderId 都存在（占位订单 + 真正订单）
    const collisionRow = await prisma.order.findUnique({
      where: { id: collisionId },
    });
    const newRow = await prisma.order.findUnique({ where: { id: r.orderId } });
    expect(collisionRow?.id).toBe(collisionId);
    expect(newRow?.id).toBe(r.orderId);
    expect(newRow?.status).toBe("pending");
  });
});
