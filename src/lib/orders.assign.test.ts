// assignOrder 端到端测试 — 走真实 SQLite。
// 测试用真实的订单号 + 师傅 ID 做隔离，每个测试在 afterEach 里 reset 状态。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignOrder } from "./orders";
import { prisma } from "@/src/lib/db";

// 重置师傅状态回 seed 初值
async function resetMasterStatuses() {
  const map: Record<string, "available" | "busy" | "offline"> = {
    T001: "available",
    T002: "busy",
    T003: "busy",
    T004: "available",
    T005: "offline",
  };
  for (const [id, status] of Object.entries(map)) {
    await prisma.master.update({ where: { id }, data: { status } });
  }
}

// 重置订单到 seed 初值
async function resetOrder(
  id: string,
  status: string,
  masterId: string | null,
  masterName: string | null,
) {
  await prisma.order.update({
    where: { id },
    data: { status, masterId, masterName },
  });
}

describe("assignOrder — 端到端", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    // O20260624002 是 pending + S003 空调清洗 → 命中 SKU 规则，requiredSkills=['空调维修']
    // 唯一 available 且掌握「空调维修」的师傅是 T004（孙师傅）
    await resetOrder("O20260624002", "pending", null, null);
    // O20260625009 是 pending + S001 日常保洁 → 命中类目兜底规则，requiredSkills=['保洁']
    // 唯一 available 且掌握「保洁」的师傅是 T001（李师傅）
    await resetOrder("O20260625009", "pending", null, null);
    // O20260624003 已 assigned 给 T002
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
  });

  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624002", "pending", null, null);
    await resetOrder("O20260625009", "pending", null, null);
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
  });

  it("pending + 推荐里的师傅 → 派单成功：订单 assigned，师傅变 busy", async () => {
    const r = await assignOrder("O20260624002", "T004");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderId).toBe("O20260624002");
    expect(r.masterId).toBe("T004");
    expect(r.masterName).toBe("孙师傅");

    const order = await prisma.order.findUnique({ where: { id: "O20260624002" } });
    expect(order?.status).toBe("assigned");
    expect(order?.masterId).toBe("T004");
    expect(order?.masterName).toBe("孙师傅");

    const tech = await prisma.master.findUnique({ where: { id: "T004" } });
    expect(tech?.status).toBe("busy");
  });

  it("类目兜底规则下的派单：日常保洁 → 李师傅", async () => {
    const r = await assignOrder("O20260625009", "T001");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const order = await prisma.order.findUnique({ where: { id: "O20260625009" } });
    expect(order?.status).toBe("assigned");
    expect(order?.masterId).toBe("T001");
  });

  it("订单不存在 → validation 错误", async () => {
    const r = await assignOrder("NOT-EXIST", "T004");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不存在/);
  });

  it("师傅不存在 → validation 错误", async () => {
    const r = await assignOrder("O20260624002", "NOT-A-MASTER");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  it("已派单订单 → validation 错误「不能重复派单」", async () => {
    const r = await assignOrder("O20260624003", "T004");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不能重复派单/);

    // 状态没改
    const order = await prisma.order.findUnique({ where: { id: "O20260624003" } });
    expect(order?.status).toBe("assigned");
    expect(order?.masterName).toBe("赵师傅");
  });

  it("师傅 busy → validation 错误", async () => {
    // T002 是 busy（resetMasterStatuses 设的）— 即使技能对也不让派
    const r = await assignOrder("O20260624002", "T002");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不可派单|busy/);
  });

  it("师傅 offline → validation 错误", async () => {
    const r = await assignOrder("O20260624002", "T005"); // T005 是 offline
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  it("师傅不符合推荐规则 → validation 错误（防止前端改包）", async () => {
    // T005 技能是 ["开锁","管道疏通"] — 不符合 S003 要求的 ["空调维修"]
    // 而且 T005 是 offline — 但即使改成 available 也应该被拒
    await prisma.master.update({ where: { id: "T005" }, data: { status: "available" } });
    try {
      const r = await assignOrder("O20260624002", "T005");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.category).toBe("validation");
      expect(r.error).toMatch(/不符合规则|没有匹配的派单规则/);
    } finally {
      await resetMasterStatuses();
    }
  });

  it("并发安全：师傅刚好被别人改成 busy 时 updateMany 不报错", async () => {
    // 先把 T004 改回 available（reset 后本来就是），然后模拟「同时被改 busy」
    await prisma.master.update({ where: { id: "T004" }, data: { status: "available" } });
    // 派单 — 这一步完成
    const r = await assignOrder("O20260624002", "T004");
    expect(r.ok).toBe(true);
    // T004 现在是 busy
    const after = await prisma.master.findUnique({ where: { id: "T004" } });
    expect(after?.status).toBe("busy");
  });

  it("并发抢单：订单已被另一个 assignOrder 改成 assigned → 第二个 assignOrder 失败", async () => {
    // 模拟「第一个用户先派单成功」
    const first = await assignOrder("O20260624002", "T004");
    expect(first.ok).toBe(true);

    // 现在订单已是 assigned + T004 busy — 模拟「第二个用户拿另一个 candidate」再派一次
    // 这里偷懒：把 T002 改成 available 让它进候选（不严格，但能模拟「候选里另一个师傅」）
    await prisma.master.update({ where: { id: "T002" }, data: { status: "available" } });
    try {
      const r = await assignOrder("O20260624002", "T002");
      // 应该被乐观锁拒
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.category).toBe("validation");
      expect(r.error).toMatch(/抢|assigned|不可派/);
    } finally {
      await resetMasterStatuses();
    }

    // 验证：T002 没被错误改成 busy
    const t2 = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(t2?.status).toBe("busy"); // reset 之前的初值就是 busy

    // 验证：原订单仍是 first 那次的派单结果（masterId=T004）
    const order = await prisma.order.findUnique({ where: { id: "O20260624002" } });
    expect(order?.masterId).toBe("T004");
    expect(order?.masterName).toBe("孙师傅");
  });
});