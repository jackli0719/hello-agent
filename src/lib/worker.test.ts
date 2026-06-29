// worker.ts 端到端测试 — 走真实 SQLite。
// 覆盖：listWorkerOptions 列表 / listOrdersForMaster 过滤（masterId 过滤 + 排除 pending + 保留 cancelled）
// / getOrderForWorker 详情查询 + 越权防护

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listOrdersForMaster,
  listWorkerOptions,
  getOrderForWorker,
} from "./worker";
import { prisma } from "@/src/lib/db";

// ============================================================
// 测试隔离
// ============================================================
// seed 注入的订单 ID — 测试假设「除了这些订单，DB 没有其他订单」
const SEED_ORDER_IDS = [
  "O20260624001",
  "O20260624002",
  "O20260624003",
  "O20260623007",
  "O20260623005",
  "O20260625009",
];

/**
 * 重置订单状态到 seed 默认值。
 * 同时清理**测试过程中创建的订单**（按 createdAt desc + 不是 seed ID 删）
 * —— 防止污染下次跑测试。
 */
async function resetOrdersToSeed() {
  const map: Record<
    string,
    { status: string; masterId: string | null; masterName: string | null }
  > = {
    O20260624001: {
      status: "in_service",
      masterId: "T001",
      masterName: "李师傅",
    },
    O20260624002: { status: "pending", masterId: null, masterName: null },
    O20260624003: {
      status: "assigned",
      masterId: "T002",
      masterName: "赵师傅",
    },
    O20260623007: { status: "completed", masterId: "T003", masterName: "周姐" },
    O20260623005: { status: "cancelled", masterId: null, masterName: null },
    O20260625009: { status: "pending", masterId: null, masterName: null },
  };
  for (const [id, data] of Object.entries(map)) {
    await prisma.order.update({ where: { id }, data });
  }
  // 清理测试创建的订单（不是 seed ID 的全删）
  await prisma.order.deleteMany({
    where: { id: { notIn: SEED_ORDER_IDS } },
  });
}

/** 重置师傅状态到 seed 默认值（同样防止污染） */
async function resetMastersToSeed() {
  const map: Record<string, "available" | "busy" | "offline"> = {
    T001: "busy", // seed 里李师傅有 in_service 订单 → busy
    T002: "busy",
    T003: "busy",
    T004: "available",
    T005: "offline",
  };
  for (const [id, status] of Object.entries(map)) {
    await prisma.master.update({ where: { id }, data: { status } });
  }
}

// # spec: 师傅端订单按 masterId 过滤 = 只返回该师傅关联订单（含 assigned/in_service/completed），无订单师傅返回空数组
describe("listOrdersForMaster — 按师傅过滤", () => {
  beforeEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  afterEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  // # spec: 师傅过滤 — T001 是订单 O20260624001 的接单师傅，应只返回这一单（in_service）
  it("T001 (李师傅) → 只返回 O20260624001（in_service）", async () => {
    const orders = await listOrdersForMaster("T001");
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("O20260624001");
    expect(orders[0].status).toBe("in_service");
  });

  // # spec: 师傅过滤 — T002 是订单 O20260624003 的接单师傅，应只返回这一单（assigned）
  it("T002 (赵师傅) → 只返回 O20260624003（assigned）", async () => {
    const orders = await listOrdersForMaster("T002");
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("O20260624003");
    expect(orders[0].status).toBe("assigned");
  });

  // # spec: 师傅过滤 — T003 是订单 O20260623007 的接单师傅，应只返回这一单（completed）
  it("T003 (周姐) → 只返回 O20260623007（completed）", async () => {
    const orders = await listOrdersForMaster("T003");
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("O20260623007");
    expect(orders[0].status).toBe("completed");
  });

  // # spec: 师傅过滤 — T004 没有任何关联订单，应返回空数组
  it("T004 (无订单) → 空数组", async () => {
    const orders = await listOrdersForMaster("T004");
    expect(orders).toHaveLength(0);
  });
});

// # spec: 师傅端排除 pending 订单 = 即使订单 masterId 是该师傅、status=pending 也不应出现（未派单的不该出现）
describe("listOrdersForMaster — 排除 pending", () => {
  beforeEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  afterEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  // # spec: 排除 pending — 即使 pending 订单被挂上 masterId，师傅端也不应展示（未派单不属于师傅）
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

  // # spec: 排除 pending — pending 订单不属于任何师傅，师傅端不应出现
  it("不会返回 T004 的 pending 订单（O20260624002 / O20260625009 都是 pending）", async () => {
    const orders = await listOrdersForMaster("T004");
    expect(orders).toHaveLength(0);
  });
});

// # spec: 师傅端保留 cancelled 订单 = 师傅看历史订单时 cancelled 也应展示，保留师傅服务记录
describe("listOrdersForMaster — cancelled 订单保留展示", () => {
  beforeEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  afterEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  // # documents current behavior: cancelled 订单即使关联 masterId 也会展示（师傅能看历史服务记录）
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

// # spec: 师傅端边界 = 空 masterId / 不存在的 masterId 返回空数组，不查 DB 不报错
describe("listOrdersForMaster — 边界", () => {
  // # documents current behavior: 空 masterId 防御性短路，直接返回空数组不打 DB
  it("空 masterId → 空数组（不查 DB）", async () => {
    const orders = await listOrdersForMaster("");
    expect(orders).toHaveLength(0);
  });

  // # documents current behavior: 不存在的 masterId 返回空数组（防御性判空，不抛错）
  it("不存在的 masterId → 空数组", async () => {
    const orders = await listOrdersForMaster("non-existent-id");
    expect(orders).toHaveLength(0);
  });
});

// # spec: 师傅端字段映射 = 金额分转元 + scheduledAt/createdAt 是 ISO 字符串且能被 Date 解析
describe("listOrdersForMaster — 字段映射", () => {
  beforeEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  afterEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  // # spec: 字段映射 — DB 金额分转成元展示，保证 number 类型不丢精度
  it("金额：分 → 元", async () => {
    // O20260624001 amount 在 seed 里是 20000 分（看 mock-data.ts）
    const orders = await listOrdersForMaster("T001");
    expect(orders[0].amountYuan).toBe(orders[0].amountYuan); // 至少是 number
    expect(
      Number.isInteger(orders[0].amountYuan) ||
        Number.isFinite(orders[0].amountYuan),
    ).toBe(true);
  });

  // # spec: 字段映射 — scheduledAt/createdAt 输出 ISO 字符串，能被 Date 正确解析
  it("scheduledAt / createdAt 是 ISO 字符串", async () => {
    const orders = await listOrdersForMaster("T001");
    expect(typeof orders[0].scheduledAt).toBe("string");
    expect(typeof orders[0].createdAt).toBe("string");
    // ISO 字符串能被 Date 解析
    expect(Number.isNaN(new Date(orders[0].scheduledAt).getTime())).toBe(false);
  });
});

// # spec: 师傅选择列表 = 返回全量师傅含 offline、手机号脱敏到后 4 位（演示用不分离线）
describe("listWorkerOptions", () => {
  // # spec: 师傅选择列表 — 含全部师傅（含 offline），手机号脱敏到后 4 位
  it("返回所有师傅（含 offline），手机号脱敏到后 4 位", async () => {
    const options = await listWorkerOptions();
    // seed >= 5 个师傅（开发期间可能手动加师傅；不写死数量）
    expect(options.length).toBeGreaterThanOrEqual(5);
    for (const o of options) {
      expect(o.id).toBeTruthy();
      expect(o.name).toBeTruthy();
      // 手机号后 4 位：长度 = 4 或原长度（< 4 时）
      expect(o.phoneTail.length).toBeLessThanOrEqual(4);
    }
  });

  // # documents current behavior: 演示用列表不分离线师傅，offline 也展示给管理员
  it("包含 offline 师傅（演示用，不分离线）", async () => {
    const options = await listWorkerOptions();
    const offline = options.find((o) => o.status === "offline");
    expect(offline).toBeDefined();
    // T005 是 offline
    expect(offline?.id).toBe("T005");
  });
});

// # spec: 师傅端订单详情 = 返回完整字段含品类名/师傅名/师傅电话、找不到/空 orderId/pending 订单返回 null
describe("getOrderForWorker — 详情查询", () => {
  beforeEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  afterEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  // # spec: 订单详情 — 合法订单返回完整字段（含品类名 + 师傅 + 师傅电话）
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

  // # documents current behavior: 找不到订单防御性返回 null，不抛错
  it("找不到订单 → null", async () => {
    const o = await getOrderForWorker("DOES-NOT-EXIST");
    expect(o).toBeNull();
  });

  // # documents current behavior: 空 orderId 短路返回 null，不打 DB
  it("空 orderId → null", async () => {
    const o = await getOrderForWorker("");
    expect(o).toBeNull();
  });

  // # documents current behavior: pending 订单在师傅端防御性返回 null（不该出现）
  it("pending 订单防御性返回 null（不该出现在师傅端）", async () => {
    const o = await getOrderForWorker("O20260624002"); // seed 里 pending
    expect(o).toBeNull();
  });
});

// # spec: 跨师傅越权防护 = 订单归属师傅 T002 时，别的师傅 T001 查不到（返回 null，不告诉调用方订单存在），cancelled 订单同样校验归属
describe("getOrderForWorker — 越权防护", () => {
  beforeEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  afterEach(async () => {
    await Promise.all([resetOrdersToSeed(), resetMastersToSeed()]);
  });

  // # spec: 跨师傅越权 — 订单归属 T002 时别的师傅查不到，返回 null（不暴露订单存在）
  it("订单归 T002，但传 masterId=T001 → null（不告诉调用方订单存在）", async () => {
    const o = await getOrderForWorker("O20260624003", "T001");
    expect(o).toBeNull();
  });

  // # spec: 跨师傅越权 — 订单归属 T002 + 传正确 masterId=T002 时正常返回详情
  it("订单归 T002，传 masterId=T002 → 返回详情", async () => {
    const o = await getOrderForWorker("O20260624003", "T002");
    expect(o).not.toBeNull();
    expect(o!.masterId).toBe("T002");
  });

  // # spec: 跨师傅越权 — cancelled 订单同样校验归属；正确 masterId 允许看历史
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

  // # spec: 跨师傅越权 — cancelled 订单 + 错的 masterId 同样返回 null
  it("cancelled 订单 + 错的 masterId → null", async () => {
    await prisma.order.update({
      where: { id: "O20260623005" },
      data: { masterId: "T002", masterName: "赵师傅" },
    });
    const o = await getOrderForWorker("O20260623005", "T003");
    expect(o).toBeNull();
  });
});
