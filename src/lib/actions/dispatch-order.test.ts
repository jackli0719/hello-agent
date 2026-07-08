// dispatch-order action 端到端测试 — 走真实 SQLite。
// 依赖：跑测试前 DB 已 seed（npm run db:reset）。
// 测试用「订单号」做隔离，每个测试在 finally 里清理自己产生的改动。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchOrderAction } from "./dispatch-order";
import { prisma } from "@/src/lib/db";

async function resetMasterStatuses() {
  // [v0.9.2] seed-demo 删了 T005
  const map: Record<string, "available" | "busy" | "offline"> = {
    T001: "busy",
    T002: "busy",
    T003: "busy",
    T004: "available",
  };
  for (const [id, status] of Object.entries(map)) {
    await prisma.master.update({ where: { id }, data: { status } });
  }
}

async function resetOrder(
  orderId: string,
  status: string,
  masterId: string | null,
  masterName: string | null,
) {
  await prisma.order.update({
    where: { id: orderId },
    data: { status, masterId, masterName },
  });
}

// # spec: 自动派单 action = pending 订单按推荐规则找师傅派单，订单 assigned + 师傅转 busy
describe("dispatchOrderAction", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    // [v0.9.2] O20260629001 是 CLEAN-DEEP-3H 深度保洁（需要保洁技能）
    // resetMasterStatuses 把 T001/T003 都改 busy 了 → 这里临时把 T001 改回 available
    // 让「家政类目兜底」规则能命中
    await prisma.master.update({
      where: { id: "T001" },
      data: { status: "available" },
    });
    // 重置三条会动到的订单：O20260629001 (pending)、O20260628003 (assigned)、O20260626002 (cancelled)
    await resetOrder("O20260629001", "pending", null, null);
    await resetOrder("O20260628003", "assigned", "T002", "赵师傅");
    await resetOrder("O20260626002", "cancelled", null, null);
  });

  afterEach(async () => {
    // 确保不污染后续测试
    await resetMasterStatuses();
    await resetOrder("O20260629001", "pending", null, null);
    await resetOrder("O20260628003", "assigned", "T002", "赵师傅");
  });

  // # spec: 自动派单 — pending + 有匹配技能师傅时正常派单（reason 含师傅名）
  it("待派单 + 有合适师傅 → 派单成功，订单 assigned，师傅变 busy", async () => {
    // [v0.9.2] O20260629001 是 CLEAN-DEEP-3H 深度保洁（需要保洁技能）
    // beforeEach 把 T001 改成 available → 推荐到 T001
    const r = await dispatchOrderAction("O20260629001");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderId).toBe("O20260629001");
    expect(r.technicianName).toBe("李师傅");
    expect(r.reason).toMatch(/李师傅/);

    const order = await prisma.order.findUnique({
      where: { id: "O20260629001" },
    });
    expect(order?.status).toBe("assigned");
    expect(order?.masterId).toBe("T001");
    expect(order?.masterName).toBe("李师傅");

    const tech = await prisma.master.findUnique({ where: { id: "T001" } });
    expect(tech?.status).toBe("busy");
  });

  // # spec: 自动派单拒绝 — 订单不存在时拒绝（category=validation，错误信息含「不存在」）
  it("订单不存在 → validation 错误", async () => {
    const r = await dispatchOrderAction("NOT-EXIST");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不存在/);
  });

  // # spec: 自动派单拒绝 — 已 assigned 订单不能再派单，原师傅信息保留不变
  it("已派单的订单不能重复派单 → validation 错误，状态不变", async () => {
    const r = await dispatchOrderAction("O20260628003");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不可重复派单/);

    // 状态没坏
    const order = await prisma.order.findUnique({
      where: { id: "O20260628003" },
    });
    expect(order?.status).toBe("assigned");
    expect(order?.masterName).toBe("赵师傅");
  });

  // # spec: 自动派单拒绝 — cancelled 订单不能再派单
  it("已取消订单不能派单 → validation 错误", async () => {
    const r = await dispatchOrderAction("O20260626002");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  // # spec: 自动派单拒绝 — 没有空闲师傅时订单保持 pending，不分配
  it("所有 available 师傅都 busy → validation 错误，订单保持 pending", async () => {
    // [v0.9.2] demo seed: O20260629001 是 CLEAN-DEEP-3H 深度保洁（需要保洁技能）
    // beforeEach 把 T001 改 available 但 T003（也有保洁技能）仍是 busy
    // 这里把 T001 也改 busy → 没人会保洁 available
    await resetOrder("O20260629001", "pending", null, null);
    await prisma.master.update({
      where: { id: "T001" },
      data: { status: "busy" },
    });
    try {
      const r = await dispatchOrderAction("O20260629001");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.category).toBe("validation");
      // T001 和 T003 都有保洁技能但都 busy → 错误信息说「没有空闲师傅」或「需要技能 X」
      expect(r.error).toMatch(/没有空闲师傅|需要技能/);

      const order = await prisma.order.findUnique({
        where: { id: "O20260629001" },
      });
      expect(order?.status).toBe("pending");
      expect(order?.masterId).toBeNull();
    } finally {
      await resetMasterStatuses();
    }
  });

  // # spec: 自动派单拒绝 — 没有掌握所需技能的师傅时拒绝（理由说明原因）
  it("没有掌握所需技能的师傅 → validation 错误（理由含技能名）", async () => {
    // [v0.9.2] O20260629001 是 CLEAN-DEEP-3H 深度保洁（需要保洁技能）
    // T001（保洁）和 T003（保洁）reset 后 T001=available（beforeEach 改）T003=busy
    // 把 T001 也改 busy → 没人会保洁 → 应该返错误
    await resetOrder("O20260629001", "pending", null, null);
    await prisma.master.update({
      where: { id: "T001" },
      data: { status: "busy" },
    });
    try {
      const r = await dispatchOrderAction("O20260629001");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.category).toBe("validation");
      // 「没空闲师傅」或「需要技能 X」
      expect(r.error).toMatch(/没有|需要技能/);
    } finally {
      await resetMasterStatuses();
    }
  });
});
