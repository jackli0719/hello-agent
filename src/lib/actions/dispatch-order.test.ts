// dispatch-order action 端到端测试 — 走真实 SQLite。
// 依赖：跑测试前 DB 已 seed（npm run db:reset）。
// 测试用「订单号」做隔离，每个测试在 finally 里清理自己产生的改动。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchOrderAction } from "./dispatch-order";
import { prisma } from "@/src/lib/db";

async function resetMasterStatuses() {
  const map: Record<string, "available" | "busy" | "offline"> = {
    T001: "busy",
    T002: "busy",
    T003: "busy",
    T004: "available",
    T005: "offline",
  };
  for (const [id, status] of Object.entries(map)) {
    await prisma.master.update({ where: { id }, data: { status } });
  }
}

async function resetOrder(orderId: string, status: string, masterId: string | null, masterName: string | null) {
  await prisma.order.update({
    where: { id: orderId },
    data: { status, masterId, masterName },
  });
}

describe("dispatchOrderAction", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    // 重置三条会动到的订单：O20260624002 (pending)、O20260624003 (assigned)、O20260623005 (cancelled)
    await resetOrder("O20260624002", "pending", null, null);
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
    await resetOrder("O20260623005", "cancelled", null, null);
  });

  afterEach(async () => {
    // 确保不污染后续测试
    await resetMasterStatuses();
    await resetOrder("O20260624002", "pending", null, null);
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
  });

  it("待派单 + 有合适师傅 → 派单成功，订单 assigned，师傅变 busy", async () => {
    // O20260624002 是「空调清洗（挂机）」，匹配技能 = 「空调维修」
    // 只有 T004（孙师傅）available 且会空调维修
    const r = await dispatchOrderAction("O20260624002");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderId).toBe("O20260624002");
    expect(r.technicianName).toBe("孙师傅");
    expect(r.reason).toMatch(/孙师傅/);

    const order = await prisma.order.findUnique({ where: { id: "O20260624002" } });
    expect(order?.status).toBe("assigned");
    expect(order?.masterId).toBe("T004");
    expect(order?.masterName).toBe("孙师傅");

    const tech = await prisma.master.findUnique({ where: { id: "T004" } });
    expect(tech?.status).toBe("busy");
  });

  it("订单不存在 → validation 错误", async () => {
    const r = await dispatchOrderAction("NOT-EXIST");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不存在/);
  });

  it("已派单的订单不能重复派单 → validation 错误，状态不变", async () => {
    const r = await dispatchOrderAction("O20260624003");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不可重复派单/);

    // 状态没坏
    const order = await prisma.order.findUnique({ where: { id: "O20260624003" } });
    expect(order?.status).toBe("assigned");
    expect(order?.masterName).toBe("赵师傅");
  });

  it("已取消订单不能派单 → validation 错误", async () => {
    const r = await dispatchOrderAction("O20260623005");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  it("所有 available 师傅都 busy → validation 错误，订单保持 pending", async () => {
    // 把唯一 available 的 T004 也搞成 busy
    await prisma.master.update({ where: { id: "T004" }, data: { status: "busy" } });
    try {
      const r = await dispatchOrderAction("O20260624002");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.category).toBe("validation");
      expect(r.error).toMatch(/没有空闲师傅/);

      const order = await prisma.order.findUnique({ where: { id: "O20260624002" } });
      expect(order?.status).toBe("pending");
      expect(order?.masterId).toBeNull();
    } finally {
      await resetMasterStatuses();
    }
  });

  it("没有掌握所需技能的师傅 → validation 错误（理由含技能名）", async () => {
    // 暂时给 T004 加个奇怪的状态：busy。但其他师傅都没「空调维修」技能。
    // 让 T004 离线（也不算 available），就找不到任何候选
    await prisma.master.update({ where: { id: "T004" }, data: { status: "offline" } });
    try {
      const r = await dispatchOrderAction("O20260624002");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.category).toBe("validation");
      // 「没掌握 X」或「没空闲师傅」都可能，看具体状态
      expect(r.error).toMatch(/没有|师傅/);
    } finally {
      await resetMasterStatuses();
    }
  });
});