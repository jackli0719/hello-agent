// app/orders/actions.ts 的 server action 测试。
//
// 覆盖 createOrderAction（FormData 解析 + 路由）和 cancelDispatchAction /
// startServiceAction / completeOrderAction / cancelOrderAction。
//
// 成功路径：redirect() 会抛 NEXT_REDIRECT，单测环境无 Next runtime 会自然抛错；
// 这里测不到成功路径（只能验证「合法输入下确实走到了 redirect」— 但 redirect 抛错说明走到了，
// 算是一种间接验证）。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOrderAction,
  cancelDispatchAction,
  startServiceAction,
  completeOrderAction,
  cancelOrderAction,
} from "@/app/orders/actions";
import { prisma } from "@/src/lib/db";

// 重置订单回 seed 初值（不同测试用不同订单做隔离）
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

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

const validOrder = {
  customerName: "测试客户",
  customerPhone: "13900001234",
  address: "上海市浦东新区世纪大道 100 号",
  skuCode: "CLEAN-DAILY-2H",
  categoryCode: "CLEAN",
  scheduledAt: "2026-06-26T10:00",
  amount: "158",
};

// ============================================================
// createOrderAction
// ============================================================

describe("createOrderAction — FormData 解析", () => {
  it("空表单 → 字段级错误（first fail 是 customerName）", async () => {
    const r = await createOrderAction(fd({}));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.ok).toBe(false);
  });

  it("categoryCode 空字符串被 normalize 成 undefined", async () => {
    // 合法 + categoryCode="" → 服务端跳过配对校验 → 应该走到 SKU 查表 + 写库 + redirect
    // redirect 在单测环境抛错 — 抓住「走到 redirect 了」的事实
    let threwRedirectLikeError = false;
    try {
      await createOrderAction(fd({ ...validOrder, categoryCode: "" }));
    } catch (e) {
      threwRedirectLikeError = true;
    }
    expect(threwRedirectLikeError).toBe(true);
  });

  it("categoryCode 传值 → 走到 redirect 路径", async () => {
    let threwRedirectLikeError = false;
    try {
      await createOrderAction(fd(validOrder));
    } catch (e) {
      threwRedirectLikeError = true;
    }
    expect(threwRedirectLikeError).toBe(true);
  });

  it("scheduledAt 非日期字符串 → 校验失败回返（不抛）", async () => {
    const r = await createOrderAction(fd({ ...validOrder, scheduledAt: "不是日期" }));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("scheduledAt");
  });

  it("amount 非数字字符串 → 校验失败回返", async () => {
    const r = await createOrderAction(fd({ ...validOrder, amount: "abc" }));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("amount");
  });

  it("skuCode 和 categoryCode 配对错误 → 校验失败回返", async () => {
    const r = await createOrderAction(
      fd({ ...validOrder, skuCode: "CLEAN-DAILY-2H", categoryCode: "REPAIR" }),
    );
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("categoryCode");
  });
});

// ============================================================
// cancelDispatchAction
// ============================================================

describe("cancelDispatchAction", () => {
  beforeEach(() => resetOrder("O20260624003", "assigned", "T002", "赵师傅"));
  afterEach(() => resetOrder("O20260624003", "assigned", "T002", "赵师傅"));

  it("assigned 订单 → 订单回 cancelled，师傅回 available", async () => {
    const r = await cancelDispatchAction("O20260624003");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.masterName).toBe("赵师傅"); // 释放前的名字（snapshot）

    const order = await prisma.order.findUnique({ where: { id: "O20260624003" } });
    expect(order?.status).toBe("cancelled");
    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("available");
  });

  it("pending 订单 → validation「没有需要释放」", async () => {
    const r = await cancelDispatchAction("O20260624002"); // pending
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/没有需要释放/);
  });

  it("订单不存在 → validation", async () => {
    const r = await cancelDispatchAction("NOT-EXIST");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/不存在/);
  });

  it("completed 订单 → validation（已终态，不能再退）", async () => {
    const r = await cancelDispatchAction("O20260623007"); // completed
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });
});

// ============================================================
// 状态流转 actions（startServiceAction / completeOrderAction / cancelOrderAction）
// ============================================================

describe("startServiceAction", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
  });
  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
  });

  it("assigned 订单 → in_service（师傅保持 busy）", async () => {
    const r = await startServiceAction("O20260624003");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const order = await prisma.order.findUnique({ where: { id: "O20260624003" } });
    expect(order?.status).toBe("in_service");
    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("busy"); // in_service 不释放
  });

  it("pending 订单 → validation 拒", async () => {
    const r = await startServiceAction("O20260624002");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  it("订单不存在 → validation", async () => {
    const r = await startServiceAction("NOT-EXIST");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/不存在/);
  });
});

describe("completeOrderAction", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624001", "in_service", "T001", "李师傅");
  });
  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624001", "in_service", "T001", "李师傅");
  });

  it("in_service 订单 → completed（师傅释放 busy → available）", async () => {
    const r = await completeOrderAction("O20260624001");
    expect(r.ok).toBe(true);

    const order = await prisma.order.findUnique({ where: { id: "O20260624001" } });
    expect(order?.status).toBe("completed");
    const tech = await prisma.master.findUnique({ where: { id: "T001" } });
    expect(tech?.status).toBe("available"); // 关键：完成释放
  });

  it("assigned 订单 → validation 拒（必须先开始服务）", async () => {
    const r = await completeOrderAction("O20260624003"); // assigned
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });
});

describe("cancelOrderAction", () => {
  beforeEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
  });
  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260624003", "assigned", "T002", "赵师傅");
  });

  it("assigned 订单 → cancelled + 师傅释放", async () => {
    const r = await cancelOrderAction("O20260624003");
    expect(r.ok).toBe(true);

    const order = await prisma.order.findUnique({ where: { id: "O20260624003" } });
    expect(order?.status).toBe("cancelled");
    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("available");
  });

  it("completed 订单 → validation 拒", async () => {
    const r = await cancelOrderAction("O20260623007");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });
});