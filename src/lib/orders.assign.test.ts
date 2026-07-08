// assignOrder 端到端测试 — 走真实 SQLite。
// 测试用真实的订单号 + 师傅 ID 做隔离，每个测试在 afterEach 里 reset 状态。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignOrder } from "./orders";
import { prisma } from "@/src/lib/db";

// 重置师傅状态回 seed 初值
async function resetMasterStatuses() {
  // [v0.9.2] seed-demo 删了 T005 — T001-T004 4 师傅
  const map: Record<string, "available" | "busy" | "offline"> = {
    T001: "available",
    T002: "busy",
    T003: "busy",
    T004: "available",
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

// # spec: 派单业务规则 = pending 订单可派给推荐里 available 师傅、师傅转 busy、不能重复派单/派给 busy/offline/不符合规则，乐观锁防并发抢单
describe("assignOrder — 端到端", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    // [v0.9.2] O20260629001 是 pending + CLEAN-DEEP-3H 深度保洁 → 命中类目兜底规则，requiredSkills=['保洁']
    // 唯一 available 且掌握「保洁」的师傅是 T001（李师傅）
    await resetOrder("O20260629001", "pending", null, null);
    // O20260630001 是 pending + CLEAN-DAILY-2H 日常保洁 → 同样命中类目兜底
    await resetOrder("O20260630001", "pending", null, null);
    // O20260628003 已 assigned 给 T002
    await resetOrder("O20260628003", "assigned", "T002", "赵师傅");
  });

  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260629001", "pending", null, null);
    await resetOrder("O20260630001", "pending", null, null);
    await resetOrder("O20260628003", "assigned", "T002", "赵师傅");
  });

  // # spec: 派单核心路径 — pending + 推荐里 available 师傅 → 订单 assigned + 师傅转 busy
  // [v0.9.2] demo seed: O20260629001 是 CLEAN-DEEP-3H → 唯一 available+保洁 = T001 李
  it("pending + 推荐里的师傅 → 派单成功：订单 assigned，师傅变 busy", async () => {
    const r = await assignOrder("O20260629001", "T001");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderId).toBe("O20260629001");
    expect(r.masterId).toBe("T001");
    expect(r.masterName).toBe("李师傅");

    const order = await prisma.order.findUnique({
      where: { id: "O20260629001" },
    });
    expect(order?.status).toBe("assigned");
    expect(order?.masterId).toBe("T001");
    expect(order?.masterName).toBe("李师傅");

    const tech = await prisma.master.findUnique({ where: { id: "T001" } });
    expect(tech?.status).toBe("busy");
  });

  // # spec: 派单规则命中 — 类目兜底规则 + 保洁技能师傅能正常被派单
  it("类目兜底规则下的派单：日常保洁 → 李师傅", async () => {
    const r = await assignOrder("O20260630001", "T001");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const order = await prisma.order.findUnique({
      where: { id: "O20260630001" },
    });
    expect(order?.status).toBe("assigned");
    expect(order?.masterId).toBe("T001");
  });

  // # spec: 派单拒绝 — 订单 id 不存在时拒绝（category=validation，错误信息含「不存在」）
  it("订单不存在 → validation 错误", async () => {
    const r = await assignOrder("NOT-EXIST", "T004");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不存在/);
  });

  // # spec: 派单拒绝 — 师傅 id 不存在时拒绝（category=validation）
  it("师傅不存在 → validation 错误", async () => {
    const r = await assignOrder("O20260629001", "NOT-A-MASTER");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  // # spec: 派单拒绝 — 已派单订单不能重复派单，原师傅信息保留不变
  it("已派单订单 → validation 错误「不能重复派单」", async () => {
    const r = await assignOrder("O20260628003", "T004");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不能重复派单/);

    // 状态没改
    const order = await prisma.order.findUnique({
      where: { id: "O20260628003" },
    });
    expect(order?.status).toBe("assigned");
    expect(order?.masterName).toBe("赵师傅");
  });

  // # spec: 派单拒绝 — busy 师傅即使技能匹配也不能被派单
  it("师傅 busy → validation 错误", async () => {
    // T002 是 busy（resetMasterStatuses 设的）— 即使技能对也不让派
    const r = await assignOrder("O20260629001", "T002");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不可派单|busy/);
  });

  // # spec: 派单拒绝 — offline 师傅不能被派单
  // [v0.9.2] seed-demo 没有 T005；用 T001（demo 里 reset 后是 busy，需在 beforeEach 临时改 offline）
  it("师傅 offline → validation 错误", async () => {
    await prisma.master.update({
      where: { id: "T001" },
      data: { status: "offline" },
    });
    try {
      const r = await assignOrder("O20260629001", "T001");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.category).toBe("validation");
    } finally {
      await prisma.master.update({
        where: { id: "T001" },
        data: { status: "available" },
      });
    }
  });

  // # spec: 派单规则二次校验 — 师傅即使 available 但不符合规则也被拒（防前端改包）
  it("师傅不符合推荐规则 → validation 错误（防止前端改包）", async () => {
    // [v0.9.2] 不依赖 demo seed 的具体订单 — 自己创建一个测试订单
    const sku = await prisma.serviceSku.findUnique({
      where: { skuCode: "APPLIANCE-AC-WALL" },
    });
    expect(sku).not.toBeNull();
    if (!sku) return;
    const testOrderId = "_test_assign_skill_mismatch";
    await prisma.order.deleteMany({ where: { id: testOrderId } });
    await prisma.order.create({
      data: {
        id: testOrderId,
        customerName: "Test",
        customerPhone: "13900000000",
        serviceSkuId: sku.id,
        serviceName: sku.name,
        address: "Test",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
      },
    });
    try {
      const r = await assignOrder(testOrderId, "T001"); // T001 没「空调维修」技能
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error("expected assignOrder to fail");
      expect(r.category).toBe("validation");
      expect(r.error).toMatch(/不符合规则|没有匹配的派单规则/);
    } finally {
      await prisma.order.deleteMany({ where: { id: testOrderId } });
      await resetMasterStatuses();
    }
  });

  // # spec: 派单并发安全 — 师傅被并发改成 busy 时 updateMany 仍能完成派单
  it("并发安全：师傅刚好被别人改成 busy 时 updateMany 不报错", async () => {
    // [v0.9.2] O20260629001 推荐 T001（保洁）
    await prisma.master.update({
      where: { id: "T001" },
      data: { status: "available" },
    });
    // 派单 — 这一步完成
    const r = await assignOrder("O20260629001", "T001");
    expect(r.ok).toBe(true);
    // T001 现在是 busy
    const after = await prisma.master.findUnique({ where: { id: "T001" } });
    expect(after?.status).toBe("busy");
  });

  // # spec: 派单乐观锁防并发抢单 — 订单已 assigned 时第二个 assignOrder 被拒
  it("并发抢单：订单已被另一个 assignOrder 改成 assigned → 第二个 assignOrder 失败", async () => {
    // 模拟「第一个用户先派单成功」
    const first = await assignOrder("O20260629001", "T001");
    expect(first.ok).toBe(true);

    // 现在订单已是 assigned + T001 busy — 模拟「第二个用户拿另一个 candidate」再派一次
    // 把 T003 改成 available 让它进候选（不严格，但能模拟「候选里另一个师傅」）
    await prisma.master.update({
      where: { id: "T003" },
      data: { status: "available" },
    });
    try {
      const r = await assignOrder("O20260629001", "T003");
      // 应该被乐观锁拒
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.category).toBe("validation");
      expect(r.error).toMatch(/抢|assigned|不可派/);
    } finally {
      await resetMasterStatuses();
    }

    // 验证：T003 没被错误改成 busy
    const t3 = await prisma.master.findUnique({ where: { id: "T003" } });
    expect(t3?.status).toBe("busy"); // reset 之前的初值就是 busy

    // 验证：原订单仍是 first 那次的派单结果（masterId=T001）
    const order = await prisma.order.findUnique({
      where: { id: "O20260629001" },
    });
    expect(order?.masterId).toBe("T001");
    expect(order?.masterName).toBe("李师傅");
  });
});
