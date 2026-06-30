// transitionOrder 端到端测试 — 走真实 SQLite。
// 覆盖：合法流转、非法流转、取消时释放师傅、并发兜底。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { transitionOrder } from "./orders";
import { prisma } from "@/src/lib/db";

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

// # spec: 状态机合法路径 = pending→cancelled、assigned→in_service、assigned→cancelled（释放师傅）、in_service→completed（释放师傅回 available）、in_service→cancelled（释放）
describe("transitionOrder — 合法流转", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    // 把 in_service / assigned 订单对应的师傅改成 busy（模拟真实接单场景）
    await prisma.master.update({
      where: { id: "T001" },
      data: { status: "busy" },
    });
    await prisma.master.update({
      where: { id: "T002" },
      data: { status: "busy" },
    });
    await prisma.master.update({
      where: { id: "T003" },
      data: { status: "busy" },
    });
    await resetOrder("O20260624002", "pending", null, null); // pending
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅"); // assigned
    await resetOrder("O20260624001", "in_service", "T001", "李师傅"); // in_service
    await resetOrder("O20260623007", "completed", "T003", "周姐"); // completed
    await resetOrder("O20260623005", "cancelled", null, null); // cancelled
  });

  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624002", "pending", null, null);
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
    await resetOrder("O20260624001", "in_service", "T001", "李师傅");
    await resetOrder("O20260623007", "completed", "T003", "周姐");
    await resetOrder("O20260623005", "cancelled", null, null);
  });

  // # spec: 状态流转 — pending 可直接 cancelled，不释放师傅（无师傅可释放）
  // [v0.9.0] 业务规则 #14：所有 cancel 状态都必填 cancelReason
  it("pending → cancelled（无师傅，单纯改 status）", async () => {
    const r = await transitionOrder(
      "O20260624002",
      "cancelled",
      undefined,
      "测试取消",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const order = await prisma.order.findUnique({
      where: { id: "O20260624002" },
    });
    expect(order?.status).toBe("cancelled");
    expect(order?.cancelReason).toBe("测试取消");
    // 没师傅，masterId 仍 null
    expect(order?.masterId).toBeNull();
  });

  // # spec: 状态流转 — assigned → in_service，师傅保持 busy（不释放）
  it("assigned → in_service（开始服务）", async () => {
    const r = await transitionOrder("O20260624003", "in_service");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const order = await prisma.order.findUnique({
      where: { id: "O20260624003" },
    });
    expect(order?.status).toBe("in_service");
    // 师傅保持 busy（in_service 不释放）
    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("busy");
  });

  // # spec: 状态流转 — assigned → cancelled 必须释放师傅（busy → available）
  // [v0.9.0] 业务规则 #14：所有 cancel 状态都必填 cancelReason
  it("assigned → cancelled（释放师傅 busy → available）", async () => {
    const r = await transitionOrder(
      "O20260624003",
      "cancelled",
      undefined,
      "测试取消",
    );
    expect(r.ok).toBe(true);

    const order = await prisma.order.findUnique({
      where: { id: "O20260624003" },
    });
    expect(order?.status).toBe("cancelled");
    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("available");
  });

  // # spec: 状态流转 — in_service → completed 师傅释放回 available（可接下一单）
  it("in_service → completed（完成订单，师傅释放回 available）", async () => {
    const r = await transitionOrder("O20260624001", "completed");
    expect(r.ok).toBe(true);

    const order = await prisma.order.findUnique({
      where: { id: "O20260624001" },
    });
    expect(order?.status).toBe("completed");
    // 完成 = 这单做完了，师傅可以接下一单 → 释放回 available
    const tech = await prisma.master.findUnique({ where: { id: "T001" } });
    expect(tech?.status).toBe("available");
  });

  // # spec: 状态流转 — in_service → cancelled 也释放师傅（busy → available）
  // [v0.9.0] 业务规则 #14：所有 cancel 状态都必填 cancelReason
  it("in_service → cancelled（释放师傅）", async () => {
    const r = await transitionOrder(
      "O20260624001",
      "cancelled",
      undefined,
      "测试取消",
    );
    expect(r.ok).toBe(true);

    const order = await prisma.order.findUnique({
      where: { id: "O20260624001" },
    });
    expect(order?.status).toBe("cancelled");
    const tech = await prisma.master.findUnique({ where: { id: "T001" } });
    expect(tech?.status).toBe("available");
  });
});

// # spec: 状态机拒绝规则 = pending 不能直接 in_service/completed、assigned 不能直接 completed、completed/cancelled 是终态不能再变、订单不存在拒绝
describe("transitionOrder — 非法流转", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624002", "pending", null, null);
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
    await resetOrder("O20260624001", "in_service", "T001", "李师傅");
    await resetOrder("O20260623007", "completed", "T003", "周姐");
    await resetOrder("O20260623005", "cancelled", null, null);
  });

  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624002", "pending", null, null);
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
    await resetOrder("O20260624001", "in_service", "T001", "李师傅");
    await resetOrder("O20260623007", "completed", "T003", "周姐");
    await resetOrder("O20260623005", "cancelled", null, null);
  });

  // # spec: 状态机拒绝 — pending 不能直接进 in_service（必须先派单 assigned）
  it("pending → in_service 不允许（必须先派单）", async () => {
    const r = await transitionOrder("O20260624002", "in_service");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  // # spec: 状态机拒绝 — pending 不能直接 completed（必须走 assigned → in_service → completed）
  it("pending → completed 不允许", async () => {
    const r = await transitionOrder("O20260624002", "completed");
    expect(r.ok).toBe(false);
  });

  // # spec: 状态机拒绝 — assigned 不能直接 completed（必须先开始服务 in_service）
  it("assigned → completed 不允许（必须先开始服务）", async () => {
    const r = await transitionOrder("O20260624003", "completed");
    expect(r.ok).toBe(false);
  });

  // # spec: 终态不可变 — completed 订单不能再变（cancelled/in_service 都拒绝）
  it("completed 不能再变", async () => {
    const r1 = await transitionOrder("O20260623007", "cancelled");
    expect(r1.ok).toBe(false);
    const r2 = await transitionOrder("O20260623007", "in_service");
    expect(r2.ok).toBe(false);
  });

  // # spec: 终态不可变 — cancelled 订单不能再变（in_service/completed 都拒绝）
  it("cancelled 不能再变", async () => {
    const r1 = await transitionOrder("O20260623005", "in_service");
    expect(r1.ok).toBe(false);
    const r2 = await transitionOrder("O20260623005", "completed");
    expect(r2.ok).toBe(false);
  });

  // # spec: 状态流转 — 不存在的订单 id 拒绝流转（错误信息含「不存在」）
  it("订单不存在 → validation", async () => {
    const r = await transitionOrder("NOT-EXIST", "in_service");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/不存在/);
  });
});

// # spec: 乐观锁防并发 = 两个 transitionOrder 同时跑只能一个成功，另一个被 updateMany 条件拒绝，订单只被改一次
describe("transitionOrder — 并发安全", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
  });
  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
  });

  // # spec: 乐观锁并发安全 — 同时两个 transitionOrder 只一个成功，另一个被 updateMany 拒绝
  // [v0.9.0] 业务规则 #14：cancel 必填 cancelReason
  it("两个 transitionOrder 同时跑：一个成功一个被乐观锁拒", async () => {
    const [r1, r2] = await Promise.all([
      transitionOrder("O20260624003", "in_service"),
      transitionOrder("O20260624003", "cancelled", undefined, "测试取消"),
    ]);

    // 一个成功一个失败
    const successCount = [r1, r2].filter((r) => r.ok).length;
    const failCount = [r1, r2].filter((r) => !r.ok).length;
    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    // 失败的应该是 validation — 「已被并发改」/「不能变更」/「请填写取消原因」皆属 validation
    const failed = [r1, r2].find((r) => !r.ok);
    if (failed && !failed.ok) {
      expect(failed.category).toBe("validation");
      expect(failed.error).toMatch(/已被|不能变更|请填写取消原因/);
    }

    // 订单只被改一次
    const order = await prisma.order.findUnique({
      where: { id: "O20260624003" },
    });
    expect(["in_service", "cancelled"]).toContain(order?.status);

    // 师傅状态根据成功的那次决定
    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    if (order?.status === "in_service") {
      expect(tech?.status).toBe("busy"); // in_service 不释放
    } else if (order?.status === "cancelled") {
      expect(tech?.status).toBe("available"); // cancelled 释放
    }
  });
});
