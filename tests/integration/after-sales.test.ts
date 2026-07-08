// [任务 21] 售后工单 — 端到端集成测试
//
// 覆盖：
// 1. 完整闭环：completed 订单 → 客户发起 → admin 受理 → admin 解决
// 2. ActivityLog + Notification 4 触发点全程落地
// 3. 拒绝流程：pending → rejected（含必填 reason）
// 4. 终态不可变：resolved 后再 resolve / reject 失败
// 5. 退款冲突：payStatus=refunded 不能发起售后
//
// 设计（CLAUDE.md P0-5 教训）：
// - 复用真实 PG（vitest 关 fileParallelism）
// - 复用 after-sales.ts 业务函数（不走 server action）
// - 自建 PREFIX fixture（不污染 seed）
// - 每个 it() 都带 # spec: 注释（CLAUDE.md P0-2）
// - 复用 seed 的 admin 用户验证通知落地

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import {
  createTicket,
  startProcessing,
  resolve as asResolve,
  reject as asReject,
} from "@/src/lib/after-sales";
import { getLatestDispatchFailure } from "@/src/lib/auto-dispatch";
import { createActivityLog } from "@/src/lib/activity-log";

const PREFIX = "_test_int_after_sales_";

// 复用 seed admin user（admin 通知验证用）
let adminUserId: string;
const CUSTOMER_ACTOR = { id: "_test_int_customer", name: "_test_int_customer" };
const ADMIN_ACTOR = { id: "_test_int_admin", name: "_test_int_admin" };

async function makeCompletedOrder(
  suffix: string,
  overrides: Partial<{ payStatus: "paid" | "refunded" }> = {},
): Promise<string> {
  const orderId = `${PREFIX}${suffix}`;
  await prisma.order.create({
    data: {
      id: orderId,
      customerName: "集成测试客户",
      // [任务 21] 用 seed customer1 的 phone (13900000099) — 让 notifyCustomerByPhone 能查到 user
      customerPhone: "13900000099",
      serviceSkuId: null,
      serviceName: "_test_int_sku",
      masterId: null,
      masterName: null,
      province: "广东省",
      city: "深圳市",
      district: "南山区",
      street: "粤海街道",
      addressDetail: "1",
      address: "测试",
      scheduledAt: new Date(),
      amount: 10000,
      status: "completed", // 集成测试入口：已完成订单
      payStatus: overrides.payStatus ?? "paid",
    },
  });
  return orderId;
}

describe("after-sales — 端到端集成", () => {
  beforeAll(async () => {
    // 找 seed admin 用户
    const a = await prisma.user.findFirst({
      where: { role: "admin" },
      select: { id: true },
    });
    if (!a) throw new Error("需要先 npm run db:reset（缺 admin）");
    adminUserId = a.id;
  });

  beforeEach(async () => {
    // 清理测试订单 + 关联日志 / 通知
    await prisma.order.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.activityLog.deleteMany({
      where: { targetId: { startsWith: PREFIX } },
    });
    await prisma.notification.deleteMany({
      where: { orderId: { startsWith: PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.activityLog.deleteMany({
      where: { targetId: { startsWith: PREFIX } },
    });
    await prisma.notification.deleteMany({
      where: { orderId: { startsWith: PREFIX } },
    });
  });

  // ============================================================
  // 验收点 1：完整闭环 — 已完成订单 → 客户发起 → admin 受理 → admin 解决
  // ============================================================

  // # spec: 端到端状态机 — pending → processing → resolved，全程 ActivityLog + Notification 落地
  it("验收点 1: 完整售后闭环 pending → processing → resolved", async () => {
    const orderId = await makeCompletedOrder("001_full_flow");

    // Step 1: 客户发起
    const r1 = await createTicket(orderId, "清洁不到位", CUSTOMER_ACTOR);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.afterSalesStatus).toBe("pending");

    // 验证副作用：ActivityLog after_sales_pending + 通知
    const log1 = await prisma.activityLog.findFirst({
      where: { targetId: orderId, action: "after_sales_pending" },
    });
    expect(log1).not.toBeNull();
    expect(log1?.actorRole).toBe("customer");

    const notif1 = await prisma.notification.findFirst({
      where: { orderId, type: "after_sales_pending", role: "admin" },
    });
    expect(notif1).not.toBeNull();
    expect(notif1?.content).toMatch(/清洁不到位/);

    // Step 2: admin 受理
    const r2 = await startProcessing(orderId, ADMIN_ACTOR);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.afterSalesStatus).toBe("processing");

    // 通知 customer
    const notif2 = await prisma.notification.findFirst({
      where: { orderId, type: "after_sales_processing", role: "customer" },
    });
    expect(notif2).not.toBeNull();

    // Step 3: admin 解决（带 note）
    const r3 = await asResolve(orderId, ADMIN_ACTOR, "已联系师傅返工");
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.afterSalesStatus).toBe("resolved");

    // 验证 afterSalesHandledBy / HandledAt + reason 落库
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.afterSalesStatus).toBe("resolved");
    expect(order?.afterSalesHandledBy).toBe(ADMIN_ACTOR.id);
    expect(order?.afterSalesHandledAt).not.toBeNull();
    // [任务 21 决策 #2] resolved 不联动 payStatus
    expect(order?.payStatus).toBe("paid");

    // 通知 customer 已解决
    const notif3 = await prisma.notification.findFirst({
      where: { orderId, type: "after_sales_resolved", role: "customer" },
    });
    expect(notif3).not.toBeNull();
    expect(notif3?.content).toMatch(/已联系师傅返工/);
    expect(notif3?.content).toMatch(/退款请联系客服/); // 不联动退款提示
  });

  // ============================================================
  // 验收点 2：拒绝流程 — pending → rejected，含 reason
  // ============================================================

  // # spec: 拒绝流程 — pending/processing → rejected，reason 必填，ActivityLog fromStatus
  it("验收点 2: 拒绝流程 pending → rejected（reason 写入 + 通知 customer 带原因）", async () => {
    const orderId = await makeCompletedOrder("002_reject");

    await createTicket(orderId, "申请退款", CUSTOMER_ACTOR);

    const r = await asReject(orderId, "已超出售后受理期限", ADMIN_ACTOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.afterSalesStatus).toBe("rejected");

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.afterSalesRejectReason).toBe("已超出售后受理期限");
    expect(order?.afterSalesHandledBy).toBe(ADMIN_ACTOR.id);

    // ActivityLog 含 fromStatus (pending)
    const log = await prisma.activityLog.findFirst({
      where: { targetId: orderId, action: "after_sales_rejected" },
    });
    expect(log).not.toBeNull();
    const meta = JSON.parse(log!.metadata) as { fromStatus: string };
    expect(meta.fromStatus).toBe("pending");

    // 通知 customer 含拒绝原因
    const notif = await prisma.notification.findFirst({
      where: { orderId, type: "after_sales_rejected", role: "customer" },
    });
    expect(notif).not.toBeNull();
    expect(notif?.content).toMatch(/已超出售后受理期限/);
  });

  // ============================================================
  // 验收点 3：终态不可变 — resolved 后再 resolve / reject 都失败
  // ============================================================

  // # spec: 终态不可变（resolved/rejected 是迁移终点）— 与 Order.completed/cancelled 同款
  it("验收点 3: 终态不可变（resolved 后再 reject 失败）", async () => {
    const orderId = await makeCompletedOrder("003_terminal");
    await createTicket(orderId, "测试", CUSTOMER_ACTOR);
    await startProcessing(orderId, ADMIN_ACTOR);
    await asResolve(orderId, ADMIN_ACTOR);

    // 再次 reject → 失败
    const r = await asReject(orderId, "再试一次", ADMIN_ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/终态|已.*解决|resolv/i);
  });

  // ============================================================
  // 验收点 4：退款冲突 — payStatus=refunded 不能发起售后
  // ============================================================

  // # spec: 退款冲突 — completed+refunded 不能再发起售后（演示期简化）
  it("验收点 4: payStatus=refunded 订单 createTicket 拒绝", async () => {
    const orderId = await makeCompletedOrder("004_refunded", {
      payStatus: "refunded",
    });

    const r = await createTicket(orderId, "已退款还想售后", CUSTOMER_ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/已退款/);
  });

  // ============================================================
  // 验收点 5：与 dispatch 失败混跑，getLatestDispatchFailure 不串
  // ============================================================

  // # spec: 售后通知与派单失败的 ActivityLog 互不干扰 — getLatestDispatchFailure 仍返派单失败
  it("验收点 5: 售后 ActivityLog 不污染派单失败查询", async () => {
    // 造一笔 pending+paid 订单 + 模拟派单失败日志
    const pendingOrderId = `${PREFIX}005_dispatch_fail`;
    await prisma.order.create({
      data: {
        id: pendingOrderId,
        customerName: "派单失败测试",
        customerPhone: "13900090012",
        serviceName: "_test",
        address: "测试",
        scheduledAt: new Date(),
        amount: 10000,
        status: "pending",
        payStatus: "paid",
      },
    });
    await createActivityLog({
      action: "auto_dispatch_failed",
      targetType: "order",
      targetId: pendingOrderId,
      message: "模拟派单失败",
      metadata: { failureCode: "no_skill_matched" },
      // 显式传 actor，跳开 session 调用（test 环境无 Next runtime）
      actorId: "_test_int_dispatch_fail",
      actorName: "_test_int",
      actorRole: "system",
    });

    // 拿派单失败原因
    const dispatchFailure = await getLatestDispatchFailure(pendingOrderId);
    expect(dispatchFailure).not.toBeNull();
    expect(dispatchFailure?.failureCode).toBe("no_skill_matched");

    // 再次写一条售后 pending 不应该污染派单失败查询
    const completedOrderId = await makeCompletedOrder("005b");
    await createTicket(completedOrderId, "测试", CUSTOMER_ACTOR);

    // 派单失败 query 应该只查 auto_dispatch_failed action
    const stillDispatch = await getLatestDispatchFailure(pendingOrderId);
    expect(stillDispatch?.failureCode).toBe("no_skill_matched");

    // 清理
    await prisma.activityLog.deleteMany({
      where: { targetId: pendingOrderId },
    });
  });
});
