// release-order 端到端测试 — 走真实 SQLite。
// 测试用「订单号」隔离，每个测试在 afterEach 里重置 DB 状态。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { releaseOrderAction } from "./release-order";
import { prisma } from "@/src/lib/db";

// 把师傅状态重置回 seed 初值
async function resetMasterStatuses() {
  const map: Record<string, "available" | "busy" | "offline"> = {
    T001: "busy", T002: "busy", T003: "busy", T004: "available", T005: "offline",
  };
  for (const [id, status] of Object.entries(map)) {
    await prisma.master.update({ where: { id }, data: { status } });
  }
}

// 把订单状态重置回 seed 初值
async function resetOrder(id: string, status: string, masterId: string | null, masterName: string | null) {
  await prisma.order.update({ where: { id }, data: { status, masterId, masterName } });
}

describe("releaseOrderAction", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
  });

  afterEach(async () => {
    await resetMasterStatuses();
    // 重置会动到的订单
    await resetOrder("O20260624002", "pending", null, null);
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
    await resetOrder("O20260624001", "in_service", "T001", "李师傅");
  });

  it("assigned 订单完成 → 订单 completed，师傅 busy → available", async () => {
    // O20260624003 初始 assigned + T002 busy
    const before = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(before?.status).toBe("busy");

    const r = await releaseOrderAction("O20260624003", "completed");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderId).toBe("O20260624003");
    expect(r.status).toBe("completed");

    const order = await prisma.order.findUnique({ where: { id: "O20260624003" } });
    expect(order?.status).toBe("completed");
    // masterId / masterName 保留（历史快照），不抹掉

    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("available");
  });

  it("in_service 订单完成 → 师傅也释放", async () => {
    // O20260624001 初始 in_service + T001 busy
    const r = await releaseOrderAction("O20260624001", "completed");
    expect(r.ok).toBe(true);

    const tech = await prisma.master.findUnique({ where: { id: "T001" } });
    expect(tech?.status).toBe("available");
  });

  it("订单取消 → 师傅也释放", async () => {
    // 先把 O20260624003 改成 assigned + T002 busy（已经是这个状态）
    const r = await releaseOrderAction("O20260624003", "cancelled");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("cancelled");

    const order = await prisma.order.findUnique({ where: { id: "O20260624003" } });
    expect(order?.status).toBe("cancelled");

    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("available");
  });

  it("pending 订单没有师傅可释放 → validation 错误", async () => {
    const r = await releaseOrderAction("O20260624002", "completed");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/没有需要释放/);
  });

  it("completed 订单再完成一次 → validation 错误（已释放过）", async () => {
    // O20260623007 初始 completed（且没有 masterId）
    const r = await releaseOrderAction("O20260623007", "completed");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  it("订单不存在 → validation 错误", async () => {
    const r = await releaseOrderAction("NOT-EXIST", "completed");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/不存在/);
  });

  it("非法状态参数 → validation 错误", async () => {
    // TS 类型层不允许，但 runtime 兜底
    const r = await releaseOrderAction("O20260624003", "pending" as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  it("并发安全：师傅已经被人改回 available 时不会报错", async () => {
    // 模拟并发：先手工把 T002 改回 available，再调 release
    await prisma.master.update({ where: { id: "T002" }, data: { status: "available" } });
    const r = await releaseOrderAction("O20260624003", "completed");
    // 仍然成功 — updateMany 找不到 busy 的就不更新
    expect(r.ok).toBe(true);
    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("available"); // 还是 available，没被错改成别的
  });
});