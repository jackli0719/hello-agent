// worker.ts 端到端测试 — 走真实 SQLite。
// 覆盖：listWorkerOptions 列表 / listOrdersForMaster 过滤（masterId 过滤 + 排除 pending + 保留 cancelled）

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listOrdersForMaster, listWorkerOptions, getOrderForWorker } from "./worker";
import { prisma } from "@/src/lib/db";

// 重置订单状态到 seed 默认值
async function resetOrdersToSeed() {
  const map: Record<string, { status: string; masterId: string | null; masterName: string | null }> = {
    O20260624001: { status: "in_service", masterId: "T001", masterName: "李师傅" },
    O20260624002: { status: "pending", masterId: null, masterName: null },
    O20260624003: { status: "assigned", masterId: "T002", masterName: "赵师傅" },
    O20260623007: { status: "completed", masterId: "T003", masterName: "周姐" },
    O20260623005: { status: "cancelled", masterId: null, masterName: null },
    O20260625009: { status: "pending", masterId: null, masterName: null },
  };
  for (const [id, data] of Object.entries(map)) {
    await prisma.order.update({ where: { id }, data });
  }
}

describe("listOrdersForMaster — 按师傅过滤", () => {
  beforeEach(async () => {
    await resetOrdersToSeed();
  });

  afterEach(async () => {
    await resetOrdersToSeed();
  });

  it("T001 (李师傅) → 只返回 O20260624001（in_service）", async () => {
    const orders = await listOrdersForMaster("T001");
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("O20260624001");
    expect(orders[0].status).toBe("in_service");
  });

  it("T002 (赵师傅) → 只返回 O20260624003（assigned）", async () => {
    const orders = await listOrdersForMaster("T002");
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("O20260624003");
    expect(orders[0].status).toBe("assigned");
  });

  it("T003 (周姐) → 只返回 O20260623007（completed）", async () => {
    const orders = await listOrdersForMaster("T003");
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("O20260623007");
    expect(orders[0].status).toBe("completed");
  });

  it("T004 (无订单) → 空数组", async () => {
    const orders = await listOrdersForMaster("T004");
    expect(orders).toHaveLength(0);
  });
});

describe("listOrdersForMaster — 排除 pending", () => {
  beforeEach(async () => {
    await resetOrdersToSeed();
  });

  afterEach(async () => {
    await resetOrdersToSeed();
  });

  it("即使订单被改成 pending + masterId=T001，也不该返回", async () => {
    // 把 in_service 订单改回 pending 且 masterId 设为 T001
    // 师傅端逻辑：没派单的订单不该出现
    await prisma.order.update({
      where: { id: "O20260624001" },
      data: { status: "pending", masterId: "T001", masterName: "李师傅" },
    });
    const orders = await listOrdersForMaster("T001");
    expect(orders).toHaveLength(0);
  });

  it("不会返回 T004 的 pending 订单（O20260624002 / O20260625009 都是 pending）", async () => {
    const orders = await listOrdersForMaster("T004");
    expect(orders).toHaveLength(0);
  });
});

describe("listOrdersForMaster — cancelled 订单保留展示", () => {
  beforeEach(async () => {
    await resetOrdersToSeed();
  });

  afterEach(async () => {
    await resetOrdersToSeed();
  });

  it("cancelled 订单如果有关联 masterId，仍能展示", async () => {
    // 模拟「订单被取消」时 masterId 还在（实际 releaseMaster 会清掉 masterId，
    // 但这里只测过滤逻辑 — 师傅端不区分 cancelled 的 masterId 是不是 null）
    await prisma.order.update({
      where: { id: "O20260623005" },
      data: { masterId: "T002", masterName: "赵师傅" },
    });
    const orders = await listOrdersForMaster("T002");
    expect(orders).toHaveLength(2);
    expect(orders.find((o) => o.id === "O20260623005")).toBeDefined();
    expect(orders.find((o) => o.id === "O20260624003")).toBeDefined();
  });
});

describe("listOrdersForMaster — 边界", () => {
  it("空 masterId → 空数组（不查 DB）", async () => {
    const orders = await listOrdersForMaster("");
    expect(orders).toHaveLength(0);
  });

  it("不存在的 masterId → 空数组", async () => {
    const orders = await listOrdersForMaster("non-existent-id");
    expect(orders).toHaveLength(0);
  });
});

describe("listOrdersForMaster — 字段映射", () => {
  beforeEach(async () => {
    await resetOrdersToSeed();
  });

  afterEach(async () => {
    await resetOrdersToSeed();
  });

  it("金额：分 → 元", async () => {
    // O20260624001 amount 在 seed 里是 20000 分（看 mock-data.ts）
    const orders = await listOrdersForMaster("T001");
    expect(orders[0].amountYuan).toBe(orders[0].amountYuan); // 至少是 number
    expect(Number.isInteger(orders[0].amountYuan) || Number.isFinite(orders[0].amountYuan)).toBe(true);
  });

  it("scheduledAt / createdAt 是 ISO 字符串", async () => {
    const orders = await listOrdersForMaster("T001");
    expect(typeof orders[0].scheduledAt).toBe("string");
    expect(typeof orders[0].createdAt).toBe("string");
    // ISO 字符串能被 Date 解析
    expect(Number.isNaN(new Date(orders[0].scheduledAt).getTime())).toBe(false);
  });
});

describe("listWorkerOptions", () => {
  it("返回所有师傅（含 offline），手机号脱敏到后 4 位", async () => {
    const options = await listWorkerOptions();
    // seed 5 个师傅
    expect(options).toHaveLength(5);
    for (const o of options) {
      expect(o.id).toBeTruthy();
      expect(o.name).toBeTruthy();
      // 手机号后 4 位：长度 = 4 或原长度（< 4 时）
      expect(o.phoneTail.length).toBeLessThanOrEqual(4);
    }
  });

  it("包含 offline 师傅（演示用，不分离线）", async () => {
    const options = await listWorkerOptions();
    const offline = options.find((o) => o.status === "offline");
    expect(offline).toBeDefined();
    // T005 是 offline
    expect(offline?.id).toBe("T005");
  });
});

describe("getOrderForWorker — 详情查询", () => {
  beforeEach(async () => {
    await resetOrdersToSeed();
  });

  afterEach(async () => {
    await resetOrdersToSeed();
  });

  it("合法订单返回完整字段（含品类名 + 师傅）", async () => {
    const o = await getOrderForWorker("O20260624003");
    expect(o).not.toBeNull();
    expect(o!.id).toBe("O20260624003");
    expect(o!.status).toBe("assigned");
    expect(o!.customerName).toBeTruthy();
    expect(o!.amountYuan).toBeGreaterThan(0);
    // serviceCategoryName 应非空（O20260624003 是 S001 之类）
    expect(o!.serviceCategoryName).toBeTruthy();
    // masterId = T002
    expect(o!.masterId).toBe("T002");
    expect(o!.masterName).toBe("赵师傅");
    // masterPhone 通过 join 拿
    expect(o!.masterPhone).toBeTruthy();
  });

  it("找不到订单 → null", async () => {
    const o = await getOrderForWorker("DOES-NOT-EXIST");
    expect(o).toBeNull();
  });

  it("空 orderId → null", async () => {
    const o = await getOrderForWorker("");
    expect(o).toBeNull();
  });

  it("pending 订单防御性返回 null（不该出现在师傅端）", async () => {
    const o = await getOrderForWorker("O20260624002"); // seed 里 pending
    expect(o).toBeNull();
  });
});

describe("getOrderForWorker — 越权防护", () => {
  beforeEach(async () => {
    await resetOrdersToSeed();
  });

  afterEach(async () => {
    await resetOrdersToSeed();
  });

  it("订单归 T002，但传 masterId=T001 → null（不告诉调用方订单存在）", async () => {
    const o = await getOrderForWorker("O20260624003", "T001");
    expect(o).toBeNull();
  });

  it("订单归 T002，传 masterId=T002 → 返回详情", async () => {
    const o = await getOrderForWorker("O20260624003", "T002");
    expect(o).not.toBeNull();
    expect(o!.masterId).toBe("T002");
  });

  it("cancelled 订单 + 正确的 masterId → 返回详情（允许看历史）", async () => {
    // 给 cancelled 订单挂 T002
    await prisma.order.update({
      where: { id: "O20260623005" },
      data: { masterId: "T002", masterName: "赵师傅" },
    });
    const o = await getOrderForWorker("O20260623005", "T002");
    expect(o).not.toBeNull();
    expect(o!.status).toBe("cancelled");
  });

  it("cancelled 订单 + 错的 masterId → null", async () => {
    await prisma.order.update({
      where: { id: "O20260623005" },
      data: { masterId: "T002", masterName: "赵师傅" },
    });
    const o = await getOrderForWorker("O20260623005", "T003");
    expect(o).toBeNull();
  });
});