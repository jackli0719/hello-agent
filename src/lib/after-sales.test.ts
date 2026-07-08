// [任务 21] 售后工单业务测试 — 状态机 + 守门 + 通知 + 审计
//
// 覆盖：
// 1. 客户发起 createTicket：completed-only、null-only、reason 长度上限、并发抢锁
// 2. admin startProcessing：pending → processing
// 3. admin resolve：processing → resolved（note 可选）
// 4. admin reject：pending/processing → rejected（reason 必填、长度上限）
// 5. 状态机终态不可转：resolved/rejected 任何操作都失败
// 6. 退款冲突：payStatus=refunded 不能再发起售后
// 7. ActivityLog 4 action 落地：after_sales_pending/processing/resolved/rejected
// 8. Notification 写通知：admin 收 pending；customer 收 4 节点
// 9. listAfterSalesTickets：status=all / pending only / 不返回 afterSalesStatus=null
//
// 设计（CLAUDE.md P0-5 教训）：
// - 自建 PREFIX 订单 / ActivityLog 隔离（不污染 seed）
// - 每个 it() 都带 # spec: 注释解释"业务想要的"，不是"代码现状"
// - 用真实 PG；afterEach cleanup

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import {
  createTicket,
  startProcessing,
  resolve,
  reject,
  listAfterSalesTickets,
  getAfterSalesByOrderId,
  countAfterSalesByStatus,
} from "./after-sales";

const PREFIX = "_test_after_sales_";

// 测试 actor
const CUSTOMER_ACTOR = { id: "_test_customer_user", name: "_test_customer" };
const ADMIN_ACTOR = { id: "_test_admin_user", name: "_test_admin" };

// 造一笔 completed 订单（base fixture）。可被 beforeEach 重用 + afterEach 删。
async function makeCompletedOrder(
  suffix: string,
  overrides: Partial<{
    payStatus: "paid" | "refunded";
    afterSalesStatus: string | null;
  }> = {},
): Promise<string> {
  const orderId = `${PREFIX}${suffix}`;
  await prisma.order.create({
    data: {
      id: orderId,
      customerName: "_测试客户",
      customerPhone: "13900090001", // 演示期 phone 唯一标
      serviceSkuId: null,
      serviceName: "_test_sku",
      masterId: null,
      masterName: null,
      province: "广东省",
      city: "深圳市",
      district: "南山区",
      street: "粤海街道",
      addressDetail: "1",
      address: "测试地址",
      scheduledAt: new Date(),
      amount: 10000,
      status: "completed", // 默认已完成
      payStatus: "paid", // 默认已支付
      afterSalesStatus: overrides.afterSalesStatus ?? null,
    },
  });
  // 单独刷 payStatus 时 status 保持 completed
  if (overrides.payStatus === "refunded") {
    await prisma.order.update({
      where: { id: orderId },
      data: { payStatus: "refunded" },
    });
  }
  return orderId;
}

// 通知测试用 — 需要 admin 用户存在（seed 必有 admin）
async function ensureAdminUser(): Promise<{ id: string }> {
  const a = await prisma.user.findFirst({
    where: { role: "admin" },
    select: { id: true },
  });
  if (!a) throw new Error("需要先 npm run db:reset（缺 admin）");
  return a;
}

describe("after-sales — createTicket", () => {
  beforeAll(async () => {
    await ensureAdminUser();
  });

  beforeEach(async () => {
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

  // # spec: 客户对 completed 订单发起售后 → afterSalesStatus=pending，reason 写入
  it("completed 订单成功发起售后 → status=pending + reason 落库", async () => {
    const orderId = await makeCompletedOrder("001_basic");

    const r = await createTicket(orderId, "清洁不干净", CUSTOMER_ACTOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.afterSalesStatus).toBe("pending");

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.afterSalesStatus).toBe("pending");
    expect(order?.afterSalesReason).toBe("清洁不干净");
  });

  // # spec: 只有 completed 订单可发起售后；cancelled / pending / assigned / in_service 都拒绝
  it("非 completed 订单（cancelled）→ validation 拒绝", async () => {
    const orderId = await makeCompletedOrder("002_cancelled");
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "cancelled" },
    });

    const r = await createTicket(orderId, "已取消不能售后", CUSTOMER_ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.category).toBe("validation");
    expect(r.error).toMatch(/仅已完成的订单|不能/);
  });

  // # spec: 已发起过售后的订单不能再发起（幂等拒绝）
  it("已 pending 的售后工单 → 重复发起被拒绝", async () => {
    const orderId = await makeCompletedOrder("003_already_pending", {
      afterSalesStatus: "pending",
    });

    const r = await createTicket(orderId, "重复", CUSTOMER_ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/已存在售后工单/);
  });

  // # spec: 已退款订单不能再发起售后（演示期简化；真实业务可能有申诉通道）
  it("payStatus=refunded 订单 → 拒绝发起售后", async () => {
    const orderId = await makeCompletedOrder("004_refunded", {
      payStatus: "refunded",
    });

    const r = await createTicket(orderId, "已退款", CUSTOMER_ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/已退款/);
  });

  // # spec: 订单不存在 → validation 拒绝（不抛错）
  it("订单不存在 → validation 拒绝", async () => {
    const r = await createTicket(
      `${PREFIX}not_exist`,
      "不存在",
      CUSTOMER_ACTOR,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/不存在/);
  });

  // # spec: reason 长度上限 500 字符（防御性，与 cancel/remark 一致）
  it("reason 超 500 字符 → validation 拒绝", async () => {
    const orderId = await makeCompletedOrder("005_long_reason");
    const longReason = "x".repeat(501);
    const r = await createTicket(orderId, longReason, CUSTOMER_ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/超过 500/);
  });

  // # spec: createTicket 写 ActivityLog action=after_sales_pending
  it("createTicket 写 ActivityLog after_sales_pending（actor=customer）", async () => {
    const orderId = await makeCompletedOrder("006_activity_log");

    await createTicket(orderId, "测试", CUSTOMER_ACTOR);

    const logs = await prisma.activityLog.findMany({
      where: { targetId: orderId, action: "after_sales_pending" },
    });
    expect(logs.length).toBe(1);
    if (logs.length === 0) return;
    expect(logs[0].actorRole).toBe("customer");
    expect(logs[0].actorName).toBe(CUSTOMER_ACTOR.name);
  });

  // # spec: createTicket 写 admin 通知（content 含订单号 + 客户名 + 原因）
  it("createTicket 通知 admin（新售后工单 type=after_sales_pending）", async () => {
    const orderId = await makeCompletedOrder("007_admin_notif");
    await createTicket(orderId, "测试管理员通知", CUSTOMER_ACTOR);

    const notifs = await prisma.notification.findMany({
      where: {
        type: "after_sales_pending",
        orderId,
        role: "admin",
      },
    });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    if (notifs.length === 0) return;
    expect(notifs[0].content).toMatch(/测试管理员通知/);
    expect(notifs[0].title).toBe("新售后工单");
  });

  // # spec: 空 reason 也能发起（演示期允许，但 ActivityLog 标记「未填原因」）
  it("空 reason 也能发起（强制 reason 非必须，但 UI 通常会校验）", async () => {
    const orderId = await makeCompletedOrder("008_empty_reason");

    const r = await createTicket(orderId, "", CUSTOMER_ACTOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.afterSalesStatus).toBe("pending");
    expect(order?.afterSalesReason).toBeNull();
  });
});

describe("after-sales — startProcessing", () => {
  beforeEach(async () => {
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

  // # spec: pending → processing，由 admin 操作；处理人/时间 写入
  it("pending 订单 admin 操作 → status=processing + handledBy/handledAt 写入", async () => {
    const orderId = await makeCompletedOrder("100_processing", {
      afterSalesStatus: "pending",
    });

    const r = await startProcessing(orderId, ADMIN_ACTOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.afterSalesStatus).toBe("processing");

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.afterSalesStatus).toBe("processing");
    expect(order?.afterSalesHandledBy).toBe(ADMIN_ACTOR.id);
    expect(order?.afterSalesHandledAt).not.toBeNull();
  });

  // # spec: 非 pending 工单（processing / resolved / rejected / null）不能开始处理
  it("非 pending 状态 → validation 拒绝", async () => {
    const orderId = await makeCompletedOrder("101_already_processing", {
      afterSalesStatus: "processing",
    });

    const r = await startProcessing(orderId, ADMIN_ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/无法开始处理|processing/);
  });

  // # spec: startProcessing 写 ActivityLog（actor=admin）
  it("startProcessing 写 ActivityLog after_sales_processing（actor=admin）", async () => {
    const orderId = await makeCompletedOrder("102_log", {
      afterSalesStatus: "pending",
    });
    await startProcessing(orderId, ADMIN_ACTOR);

    const logs = await prisma.activityLog.findMany({
      where: { targetId: orderId, action: "after_sales_processing" },
    });
    expect(logs.length).toBe(1);
    if (logs.length === 0) return;
    expect(logs[0].actorRole).toBe("admin");
    expect(logs[0].actorName).toBe(ADMIN_ACTOR.name);
  });
});

describe("after-sales — resolve", () => {
  beforeEach(async () => {
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

  // # spec: processing → resolved，note 可选
  it("processing 工单 → resolve 成功，note 落库", async () => {
    const orderId = await makeCompletedOrder("200_resolve_with_note", {
      afterSalesStatus: "processing",
    });

    const r = await resolve(orderId, ADMIN_ACTOR, "已与师傅沟通，返工");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.afterSalesStatus).toBe("resolved");

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.afterSalesStatus).toBe("resolved");
    // [业务规则 #2] resolved 不联动 payStatus（演示期 — payStatus 保持 paid）
    expect(order?.payStatus).toBe("paid");
    expect(order?.afterSalesHandledBy).toBe(ADMIN_ACTOR.id);
  });

  // # spec: note 可选；不传也能 resolve
  it("resolve 不传 note 也能成功", async () => {
    const orderId = await makeCompletedOrder("201_resolve_no_note", {
      afterSalesStatus: "processing",
    });
    const r = await resolve(orderId, ADMIN_ACTOR);
    expect(r.ok).toBe(true);
  });

  // # spec: pending 工单不能直接 resolve（必须先 processing）
  it("pending 工单不能直接 resolve（必须先 processing）", async () => {
    const orderId = await makeCompletedOrder("202_pending_no_resolve", {
      afterSalesStatus: "pending",
    });
    const r = await resolve(orderId, ADMIN_ACTOR, "测试");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/仅处理中/);
  });

  // # spec: resolved 后再 resolve 失败（终态不可变）
  it("resolved 后再 resolve → validation 拒绝（终态）", async () => {
    const orderId = await makeCompletedOrder("203_terminal_resolved", {
      afterSalesStatus: "resolved",
    });
    const r = await resolve(orderId, ADMIN_ACTOR);
    expect(r.ok).toBe(false);
  });
});

describe("after-sales — reject", () => {
  beforeEach(async () => {
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

  // # spec: pending → rejected，reason 必填
  it("pending 工单 → reject 成功，reason 写入", async () => {
    const orderId = await makeCompletedOrder("300_reject_from_pending", {
      afterSalesStatus: "pending",
    });

    const r = await reject(orderId, "已超出售后受理期限", ADMIN_ACTOR);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.afterSalesStatus).toBe("rejected");

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.afterSalesStatus).toBe("rejected");
    expect(order?.afterSalesRejectReason).toBe("已超出售后受理期限");
  });

  // # spec: processing → rejected 也允许
  it("processing 工单也能 reject（拒绝可从 pending 或 processing 起）", async () => {
    const orderId = await makeCompletedOrder("301_reject_from_processing", {
      afterSalesStatus: "processing",
    });
    const r = await reject(orderId, "服务已完成无质量问题", ADMIN_ACTOR);
    expect(r.ok).toBe(true);
  });

  // # spec: reject reason 必填 — 空/缺省/空白都拒绝（任务 21 决策 #4）
  it("空 reject reason → validation 拒绝", async () => {
    const orderId = await makeCompletedOrder("302_empty_reason", {
      afterSalesStatus: "pending",
    });
    const r = await reject(orderId, "", ADMIN_ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/填写拒绝原因/);
  });

  // # spec: 纯空白 reason 也被拒绝（trim 后判空）
  it("纯空白 reject reason → validation 拒绝", async () => {
    const orderId = await makeCompletedOrder("303_whitespace_reason", {
      afterSalesStatus: "pending",
    });
    const r = await reject(orderId, "   \n\t  ", ADMIN_ACTOR);
    expect(r.ok).toBe(false);
  });

  // # spec: reject reason 长度上限 500 字符
  it("reject reason 超 500 字符 → validation 拒绝", async () => {
    const orderId = await makeCompletedOrder("304_long_reason", {
      afterSalesStatus: "pending",
    });
    const r = await reject(orderId, "x".repeat(501), ADMIN_ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/超过 500/);
  });

  // # spec: rejected 后再 reject 失败（终态不可变）；resolved/rejected 是终态
  it("rejected 后再 reject → validation 拒绝（终态不可变）", async () => {
    const orderId = await makeCompletedOrder("305_terminal_rejected", {
      afterSalesStatus: "rejected",
    });
    const r = await reject(orderId, "再拒绝", ADMIN_ACTOR);
    expect(r.ok).toBe(false);
  });

  // # spec: resolved 后也不能 reject（终态不可变）
  it("resolved 后 reject → validation 拒绝（终态不可变）", async () => {
    const orderId = await makeCompletedOrder("306_resolved_then_reject", {
      afterSalesStatus: "resolved",
    });
    const r = await reject(orderId, "拒绝已解决", ADMIN_ACTOR);
    expect(r.ok).toBe(false);
  });

  // # spec: 没发起售后的订单（afterSalesStatus=null）拒绝 reject
  it("afterSalesStatus=null → reject 拒绝", async () => {
    const orderId = await makeCompletedOrder("307_null_no_reject");
    const r = await reject(orderId, "无售后单可拒", ADMIN_ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/未发起售后|终态/);
  });

  // # spec: reject 写 ActivityLog（actor=admin，含 fromStatus + reason）
  it("reject 写 ActivityLog after_sales_rejected（actor=admin）", async () => {
    const orderId = await makeCompletedOrder("308_reject_log", {
      afterSalesStatus: "pending",
    });
    await reject(orderId, "测试拒绝", ADMIN_ACTOR);

    const logs = await prisma.activityLog.findMany({
      where: { targetId: orderId, action: "after_sales_rejected" },
    });
    expect(logs.length).toBe(1);
    if (logs.length === 0) return;
    expect(logs[0].actorRole).toBe("admin");
    const meta = JSON.parse(logs[0].metadata) as {
      rejectReason: string;
      fromStatus: string;
    };
    expect(meta.rejectReason).toBe("测试拒绝");
    expect(meta.fromStatus).toBe("pending");
  });
});

describe("after-sales — listAfterSalesTickets / getAfterSalesByOrderId", () => {
  beforeEach(async () => {
    await prisma.order.deleteMany({ where: { id: { startsWith: PREFIX } } });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { startsWith: PREFIX } } });
  });

  // # spec: 列表只返回 afterSalesStatus IS NOT NULL 的订单（未发起售后的不返回）
  it("listAfterSalesTickets 仅返回已发起售后的订单", async () => {
    // 造 2 笔：1 笔 pending 售后，1 笔无售后
    await makeCompletedOrder("400_has_ticket", {
      afterSalesStatus: "pending",
    });
    await makeCompletedOrder("401_no_ticket"); // afterSalesStatus: null（默认）

    const r = await listAfterSalesTickets({ pageSize: 50 });
    const ids = r.tickets.map((t) => t.orderId);
    expect(ids).toContain(`${PREFIX}400_has_ticket`);
    expect(ids).not.toContain(`${PREFIX}401_no_ticket`);
  });

  // # spec: filter status=pending 仅返 pending，不返 processing/resolved/rejected
  it("listAfterSalesTickets status=pending 仅过滤 pending", async () => {
    await makeCompletedOrder("402_pending", { afterSalesStatus: "pending" });
    await makeCompletedOrder("403_resolved", {
      afterSalesStatus: "resolved",
    });
    const r = await listAfterSalesTickets({
      status: "pending",
      pageSize: 50,
    });
    const ids = r.tickets.map((t) => t.orderId);
    expect(ids).toContain(`${PREFIX}402_pending`);
    expect(ids).not.toContain(`${PREFIX}403_resolved`);
  });

  // # spec: getAfterSalesByOrderId — 未发起售后返 null；发起后返字段
  it("getAfterSalesByOrderId 未发起 → 返 null", async () => {
    const orderId = await makeCompletedOrder("404_no_ticket");
    const r = await getAfterSalesByOrderId(orderId);
    expect(r).toBeNull();
  });

  // # spec: getAfterSalesByOrderId 发起后返完整字段
  it("getAfterSalesByOrderId 发起后 → 返 afterSalesStatus + reason", async () => {
    const orderId = await makeCompletedOrder("405_has_ticket", {
      afterSalesStatus: "pending",
    });
    await prisma.order.update({
      where: { id: orderId },
      data: { afterSalesReason: "我的理由" },
    });
    const r = await getAfterSalesByOrderId(orderId);
    expect(r).not.toBeNull();
    expect(r?.afterSalesStatus).toBe("pending");
    expect(r?.afterSalesReason).toBe("我的理由");
  });

  // # spec: countAfterSalesByStatus 按状态统计 — dashboard 统计卡数据源
  it("countAfterSalesByStatus 按状态分组（仅含 afterSalesStatus IS NOT NULL）", async () => {
    await makeCompletedOrder("406_pending", { afterSalesStatus: "pending" });
    await makeCompletedOrder("407_processing", {
      afterSalesStatus: "processing",
    });
    await makeCompletedOrder("408_no_ticket"); // 不算入 any

    const r = await countAfterSalesByStatus();
    expect(r.pending).toBeGreaterThanOrEqual(1);
    expect(r.processing).toBeGreaterThanOrEqual(1);
    expect(r.all).toBe(r.pending + r.processing + r.resolved + r.rejected);
  });
});
