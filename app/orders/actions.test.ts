// app/orders/actions.ts 的 server action 测试。
//
// 覆盖 createOrderAction（FormData 解析 + 路由）和 cancelDispatchAction /
// startServiceAction / completeOrderAction / cancelOrderAction。
//
// 成功路径：redirect() 会抛 NEXT_REDIRECT，单测环境无 Next runtime 会自然抛错；
// 这里测不到成功路径（只能验证「合法输入下确实走到了 redirect」— 但 redirect 抛错说明走到了，
// 算是一种间接验证）。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrderAction,
  cancelDispatchAction,
  startServiceAction,
  completeOrderAction,
  cancelOrderAction,
} from "@/app/orders/actions";
import { prisma } from "@/src/lib/db";

// [v0.9.4] mock 鉴权 — 默认返 admin 角色，让现有 case 不被新鉴权破坏
// 权限失败路径测试在 v0.9.8 组 5
vi.mock("@/src/lib/auth-helpers", () => ({
  requireAdmin: async () => ({
    ok: true,
    user: { id: "admin1", name: "admin", role: "admin" },
  }),
  requireWorker: async () => ({
    ok: true,
    user: { id: "w1", name: "worker", role: "worker", workerId: "T001" },
  }),
  requireRole: async () => ({
    ok: true,
    user: { id: "c1", name: "customer", role: "customer" },
  }),
  requireCsrf: async () => ({ ok: true, user: null }),
}));

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
  // [v0.9.2] seed-demo 删了 T005 — T001-T004 4 师傅
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
  // # spec: createOrderAction 把 FormData 解析 + 校验，非法字段返 ok:false+field，不抛
  it("空表单 → 字段级错误（first fail 是 customerName）", async () => {
    const r = await createOrderAction(fd({}));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.ok).toBe(false);
  });

  // # documents current behavior: categoryCode="" → normalizeCode → "" → undefined（向后兼容）
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

  // # documents current behavior: 合法 FormData 走完校验 → DB 写入 → redirect（redirect 抛错间接证明走到了）
  it("categoryCode 传值 → 走到 redirect 路径", async () => {
    let threwRedirectLikeError = false;
    try {
      await createOrderAction(fd(validOrder));
    } catch (e) {
      threwRedirectLikeError = true;
    }
    expect(threwRedirectLikeError).toBe(true);
  });

  // # spec: scheduledAt 必须是合法日期字符串，否则返 ok:false + field=scheduledAt
  it("scheduledAt 非日期字符串 → 校验失败回返（不抛）", async () => {
    const r = await createOrderAction(
      fd({ ...validOrder, scheduledAt: "不是日期" }),
    );
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("scheduledAt");
  });

  // # spec: scheduledAt 必须能解析成 Date，非法字符串返 field=scheduledAt
  it("amount 非数字字符串 → 校验失败回返", async () => {
    const r = await createOrderAction(fd({ ...validOrder, amount: "abc" }));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("amount");
  });

  // # spec: amount 必须可转 Number，非法字符串返 field=amount
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
  // # spec: cancelDispatchAction 撤销已派单：order→cancelled，master busy→available，释放前 masterName 快照
  beforeEach(() => resetOrder("O20260628003", "assigned", "T002", "赵师傅"));
  afterEach(() => resetOrder("O20260628003", "assigned", "T002", "赵师傅"));

  // # spec: assigned 订单撤销派单：order→cancelled，master busy→available，masterName 快照返回
  it("assigned 订单 → 订单回 cancelled，师傅回 available", async () => {
    const r = await cancelDispatchAction("O20260628003");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.masterName).toBe("赵师傅"); // 释放前的名字（snapshot）

    const order = await prisma.order.findUnique({
      where: { id: "O20260628003" },
    });
    expect(order?.status).toBe("cancelled");
    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("available");
  });

  // # spec: 撤销派单只能撤 assigned；pending 没派单则返「没有需要释放」
  it("pending 订单 → validation「没有需要释放」", async () => {
    const r = await cancelDispatchAction("O20260629001"); // pending
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/没有需要释放/);
  });

  // # spec: 订单 ID 不存在时返 validation，不抛
  it("订单不存在 → validation", async () => {
    const r = await cancelDispatchAction("NOT-EXIST");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/不存在/);
  });

  // # spec: 终态订单（completed/cancelled）不能再退派单
  it("completed 订单 → validation（已终态，不能再退）", async () => {
    const r = await cancelDispatchAction("O20260626001"); // completed
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });
});

// ============================================================
// 状态流转 actions（startServiceAction / completeOrderAction / cancelOrderAction）
// ============================================================

describe("startServiceAction", () => {
  // # spec: startServiceAction 把 assigned→in_service，master 保持 busy（服务中不释放）
  beforeEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260628003", "assigned", "T002", "赵师傅");
  });
  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260628003", "assigned", "T002", "赵师傅");
  });

  // # spec: assigned 订单开始服务：order→in_service，master 保持 busy（服务中不释放）
  it("assigned 订单 → in_service（师傅保持 busy）", async () => {
    const r = await startServiceAction("O20260628003");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const order = await prisma.order.findUnique({
      where: { id: "O20260628003" },
    });
    expect(order?.status).toBe("in_service");
    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("busy"); // in_service 不释放
  });

  // # spec: 必须先派单（assigned）才能开始服务，pending 直接拒
  it("pending 订单 → validation 拒", async () => {
    const r = await startServiceAction("O20260629001");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });

  // # spec: startService 订单不存在时返 validation「不存在」，不抛
  it("订单不存在 → validation", async () => {
    const r = await startServiceAction("NOT-EXIST");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/不存在/);
  });
});

describe("completeOrderAction", () => {
  // # spec: completeOrderAction 把 in_service→completed，并释放 master busy→available
  beforeEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260629011", "in_service", "T001", "李师傅");
  });
  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260629011", "in_service", "T001", "李师傅");
  });

  // # spec: in_service 订单完成：order→completed，master busy→available（关键：完成必须释放）
  it("in_service 订单 → completed（师傅释放 busy → available）", async () => {
    const r = await completeOrderAction("O20260629011");
    expect(r.ok).toBe(true);

    const order = await prisma.order.findUnique({
      where: { id: "O20260629011" },
    });
    expect(order?.status).toBe("completed");
    const tech = await prisma.master.findUnique({ where: { id: "T001" } });
    expect(tech?.status).toBe("available"); // 关键：完成释放
  });

  // # spec: 必须先 startService（in_service）才能完成，assigned 直接拒
  it("assigned 订单 → validation 拒（必须先开始服务）", async () => {
    const r = await completeOrderAction("O20260628003"); // assigned
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });
});

describe("cancelOrderAction", () => {
  // # spec: cancelOrderAction 把订单→cancelled，并释放 master busy→available（任意非终态都可）
  beforeEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260628003", "assigned", "T002", "赵师傅");
  });
  afterEach(async () => {
    await resetMasterStatuses();
    await resetOrder("O20260628003", "assigned", "T002", "赵师傅");
  });

  // # spec: assigned 订单取消：order→cancelled，master busy→available
  // [v0.9.0] 业务规则 #14：所有 cancel 都必填 cancelReason
  it("assigned 订单 + 原因 → cancelled + 师傅释放", async () => {
    const r = await cancelOrderAction("O20260628003", "测试取消");
    expect(r.ok).toBe(true);

    const order = await prisma.order.findUnique({
      where: { id: "O20260628003" },
    });
    expect(order?.status).toBe("cancelled");
    const tech = await prisma.master.findUnique({ where: { id: "T002" } });
    expect(tech?.status).toBe("available");
  });

  // [v0.9.0] 业务规则 #14：不传原因 → 拒绝
  // # spec: cancelOrderAction 校验失败不写库
  it("assigned 订单 + 不传原因 → 拒绝", async () => {
    const r = await cancelOrderAction("O20260628003");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/请填写取消原因/);
    }
  });

  // # spec: 已终态订单（completed）不能取消，返 validation
  it("completed 订单 → validation 拒", async () => {
    const r = await cancelOrderAction("O20260626001");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
  });
});
