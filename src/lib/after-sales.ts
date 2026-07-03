// [任务 21] 售后工单 — 状态机 + 业务规则
//
// 设计要点（CLAUDE.md P0-0 决策）：
// - 状态机：null → pending → processing → resolved / rejected
// - 终态 no rollback：resolved / rejected 是终态（与 completed / cancelled 同款）
// - 只 admin 处理：商家只看只读（任务 21 决策 #1）
// - resolved 不联动退款：仅标记完成；退款走独立 refundOrder 入口（任务 21 决策 #2）
// - rejected 必填 reason：UI 强校验 + server action 复验（任务 21 决策 #4）
// - 触发条件：仅 completed 订单可发起售后（cancelled 已经在取消时联动退款，不可重复）
//
// 复用决策（CLAUDE.md P0-4 简化即 bug）：
// - 复用 ActivityLog（free string action：after_sales_pending / processing / resolved / rejected）
// - 复用 prisma.order 表加 5 字段（不加新表，演示期 1 笔订单至多 1 笔售后）
// - 复用 Notification（4 触发点写通知，type: after_sales_* — 复用 dispatchOrderNotifications 不够灵活，
//   走 createNotification 自定义 title/content，因为售后通知不只是订单节点）

import { prisma } from "./db";
import { createActivityLog } from "./activity-log";
import { createNotification } from "./notifications";
import { logInfo, logError } from "./logger";
import { incrementCounter, METRIC } from "./metrics";

// ============================================================
// 类型 + 状态机定义
// ============================================================

/** 售后 4 状态（与 Order.afterSalesStatus 字段一致） */
export type AfterSalesStatus =
  "pending" | "processing" | "resolved" | "rejected";

/** 4 状态机转移表 — null → pending 走 createTicket；后续按表转移 */
const ALLOWED_AFTER_SALES_TRANSITIONS: Record<
  AfterSalesStatus,
  AfterSalesStatus[]
> = {
  pending: ["processing", "rejected"],
  processing: ["resolved", "rejected"],
  // 终态：resolved / rejected 无法再转
  resolved: [],
  rejected: [],
};

/** 业务结果统一返回类型 */
export type AfterSalesResult<T = true> =
  | { ok: true; orderId: string; afterSalesStatus: AfterSalesStatus }
  | { ok: false; category: "validation" | "system"; error: string };

/** 拒绝原因校验错误（专用于 reject 步骤） */
export class AfterSalesRejectReasonError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "AfterSalesRejectReasonError";
  }
}

// ============================================================
// 工具：必填 reason 校验
// ============================================================

/**
 * reject reason 校验 — 任务 21 决策 #4：拒绝必填理由。
 *
 * 复用 src/lib/validation.ts 的 validateRequiredText 模式：
 * - 必填
 * - 长度上限 500（与订单 cancel/remark 一致）
 */
function validateRejectReason(reason: unknown):
  | {
      ok: true;
      cleaned: string;
    }
  | { ok: false; error: string } {
  if (typeof reason !== "string") return { ok: false, error: "请填写拒绝原因" };
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "请填写拒绝原因" };
  if (trimmed.length > 500)
    return { ok: false, error: "拒绝原因不能超过 500 个字符" };
  return { ok: true, cleaned: trimmed };
}

// ============================================================
// 核心函数 1: createTicket — 客户发起售后
// ============================================================

/**
 * 发起售后（客户在已完成订单详情页触发）。
 *
 * 业务规则：
 * - 订单必须存在
 * - 订单 status 必须 === "completed"（仅完成订单可售后；cancelled 已联动退款）
 * - 订单必须未发起过售后（afterSalesStatus === null）
 * - payStatus 必须 !== "refunded"（已退款的订单不能再发起售后，走客服；演示期拒绝）
 *
 * 副作用：
 * - 写 Order.afterSalesStatus = "pending" + afterSalesReason + customerName
 * - 写 ActivityLog action="after_sales_pending"
 * - 写 Notification → admin 通知（"新售后工单待处理"）
 * - 通知 customer："您的售后申请已提交，等待处理"
 *
 * 不做（演示期）：
 * - 不校验 customerPhone 匹配登录账号（演示期 user.phone 与 order.customerPhone 不强一致，
 *   customer 角色从 session 取；安全由 server action 守门 ensureCustomerOwnsOrder）
 */
export async function createTicket(
  orderId: string,
  reason: string,
  actor: { id: string; name: string },
): Promise<AfterSalesResult> {
  // 1. reason 校验（reason 可选填；演示期允许空，但不推荐）
  const cleanedReason = typeof reason === "string" ? reason.trim() : "";
  if (cleanedReason.length > 500) {
    return {
      ok: false,
      category: "validation",
      error: "售后原因不能超过 500 个字符",
    };
  }

  // 2. 加载订单
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return {
      ok: false,
      category: "validation",
      error: `订单 ${orderId} 不存在`,
    };
  }

  // 3. 守门：仅 completed 可发起
  if (order.status !== "completed") {
    return {
      ok: false,
      category: "validation",
      error: `仅已完成的订单可发起售后（当前状态：${order.status}）`,
    };
  }

  // 4. 守门：未发起过
  if (order.afterSalesStatus !== null) {
    return {
      ok: false,
      category: "validation",
      error: `该订单已存在售后工单（当前状态：${order.afterSalesStatus}）`,
    };
  }

  // 5. 守门：未退过款（演示期：已退款的不要再发售后）
  if (order.payStatus === "refunded") {
    return {
      ok: false,
      category: "validation",
      error: "该订单已退款，无法再次发起售后",
    };
  }

  // 6. 事务：乐观锁改 Order.afterSalesStatus
  // 乐观锁 where: { id, afterSalesStatus: null } 防止双击 / 并发
  const result = await prisma.order.updateMany({
    where: { id: orderId, afterSalesStatus: null },
    data: {
      afterSalesStatus: "pending",
      afterSalesReason: cleanedReason || null,
    },
  });
  if (result.count === 0) {
    return {
      ok: false,
      category: "validation",
      error: "订单已被其它售后操作修改，请刷新后重试",
    };
  }

  // 7. 副作用：ActivityLog + Notification
  logInfo("after sales ticket created", { orderId, actorId: actor.id });
  incrementCounter(METRIC.AFTER_SALES_CREATED, { orderId });

  await createActivityLog({
    action: "after_sales_pending",
    targetType: "order",
    targetId: orderId,
    message: `售后工单已发起：${cleanedReason || "（未填原因）"}`,
    metadata: {
      afterSalesStatus: "pending" satisfies AfterSalesStatus,
      reason: cleanedReason || null,
      customerName: order.customerName,
    },
    actorId: actor.id,
    actorName: actor.name,
    actorRole: "customer",
  });

  // 通知 admin：新售后工单待处理
  const adminNotified = await notifyAdmins({
    orderId,
    customerPhone: order.customerPhone, // [修 bug] 给 helper 用（虽然 admin helper 不需要，但接口一致）
    type: "after_sales_pending",
    title: "新售后工单",
    content: `订单 ${orderId}（${order.customerName}）发起售后：${cleanedReason || "（未填原因）"}`,
  });

  // 通知 customer：申请已收到
  await notifyCustomerByPhone({
    customerPhone: order.customerPhone,
    orderId,
    type: "after_sales_pending",
    title: "售后申请已提交",
    content: `您的售后申请已提交（订单 ${orderId}），等待客服处理`,
  });

  // admin 通知失败不回退业务（fire-and-forget 设计一致）
  void adminNotified;

  return { ok: true, orderId, afterSalesStatus: "pending" };
}

// ============================================================
// 核心函数 2: startProcessing — admin 开始处理
// ============================================================

/**
 * 开始处理（admin 在 admin 后台点"开始处理"）。
 *
 * 业务规则：
 * - 订单必须存在
 * - 当前 afterSalesStatus 必须 === "pending"
 * - 处理人 id 必须存在（防御性，admin UI 上必须有值）
 *
 * 副作用：
 * - 写 Order.afterSalesStatus = "processing" + afterSalesHandledBy + afterSalesHandledAt
 * - 写 ActivityLog action="after_sales_processing"
 * - 通知 customer："售后已被客服受理，正在处理"
 */
export async function startProcessing(
  orderId: string,
  handler: { id: string; name: string },
): Promise<AfterSalesResult> {
  // 1. 加载订单
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return {
      ok: false,
      category: "validation",
      error: `订单 ${orderId} 不存在`,
    };
  }
  if (order.afterSalesStatus !== "pending") {
    return {
      ok: false,
      category: "validation",
      error: `当前售后状态为「${order.afterSalesStatus ?? "未发起"}」，无法开始处理`,
    };
  }

  // 2. 守门：状态机转移合法性
  if (!ALLOWED_AFTER_SALES_TRANSITIONS.pending.includes("processing")) {
    // 不会到这里（写死转移表）；保留作为防御
    return { ok: false, category: "validation", error: "非法状态转移" };
  }

  // 3. 乐观锁：只在 still pending 时改
  const handledAt = new Date();
  const result = await prisma.order.updateMany({
    where: { id: orderId, afterSalesStatus: "pending" },
    data: {
      afterSalesStatus: "processing",
      afterSalesHandledBy: handler.id,
      afterSalesHandledAt: handledAt,
    },
  });
  if (result.count === 0) {
    return {
      ok: false,
      category: "validation",
      error: "售后状态已被其它操作改变，请刷新后重试",
    };
  }

  // 4. 副作用
  logInfo("after sales processing started", {
    orderId,
    handlerId: handler.id,
  });
  incrementCounter(METRIC.AFTER_SALES_PROCESSING, { orderId });

  await createActivityLog({
    action: "after_sales_processing",
    targetType: "order",
    targetId: orderId,
    message: `售后工单已被受理（处理人：${handler.name}）`,
    metadata: {
      afterSalesStatus: "processing" satisfies AfterSalesStatus,
      handlerId: handler.id,
      handlerName: handler.name,
    },
    actorId: handler.id,
    actorName: handler.name,
    actorRole: "admin",
  });

  // 通知 customer
  await notifyCustomerByPhone({
    customerPhone: order.customerPhone,
    orderId,
    type: "after_sales_processing",
    title: "售后已被受理",
    content: `您的售后申请（订单 ${orderId}）已被客服受理，正在处理中`,
  });

  return { ok: true, orderId, afterSalesStatus: "processing" };
}

// ============================================================
// 核心函数 3: resolve — admin 解决
// ============================================================

/**
 * 解决售后（admin 在 admin 后台点"已解决"）。
 *
 * 业务规则：
 * - 订单必须存在
 * - 当前 afterSalesStatus 必须是 "processing"（不能在 pending 直接 resolved）
 * - 解决备注可选填（demon: 让 admin 留几句"如何解决的"）
 *
 * 设计决策（CLAUDE.md P0-0 决策 #2）：
 * - resolved 不联动 refundOrder（演示期）— 财务操作由 admin 在 refundOrder 入口独立触发
 *
 * 副作用：
 * - 写 afterSalesStatus = "resolved"
 * - 写 ActivityLog action="after_sales_resolved"
 * - 通知 customer："售后已解决（如需退款请联系客服）"
 */
export async function resolve(
  orderId: string,
  handler: { id: string; name: string },
  note?: string,
): Promise<AfterSalesResult> {
  // note 可选，trim 后非空就保留，否则 undefined（DB 存 null）
  const cleanedNote =
    typeof note === "string" && note.trim() ? note.trim() : undefined;
  if (cleanedNote && cleanedNote.length > 500) {
    return {
      ok: false,
      category: "validation",
      error: "解决备注不能超过 500 个字符",
    };
  }

  // 1. 加载订单
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return {
      ok: false,
      category: "validation",
      error: `订单 ${orderId} 不存在`,
    };
  }
  if (order.afterSalesStatus !== "processing") {
    return {
      ok: false,
      category: "validation",
      error: `当前售后状态为「${order.afterSalesStatus ?? "未发起"}」，仅处理中的工单可标记已解决`,
    };
  }

  // 2. 乐观锁
  const handledAt = new Date();
  const result = await prisma.order.updateMany({
    where: { id: orderId, afterSalesStatus: "processing" },
    data: {
      afterSalesStatus: "resolved",
      // 处理人 / 时间：更新到最后一次处理时刻（演示用）
      afterSalesHandledBy: handler.id,
      afterSalesHandledAt: handledAt,
    },
  });
  if (result.count === 0) {
    return {
      ok: false,
      category: "validation",
      error: "售后状态已被其它操作改变，请刷新后重试",
    };
  }

  // 3. 副作用
  logInfo("after sales resolved", { orderId, handlerId: handler.id });
  incrementCounter(METRIC.AFTER_SALES_RESOLVED, { orderId });

  await createActivityLog({
    action: "after_sales_resolved",
    targetType: "order",
    targetId: orderId,
    message: cleanedNote ? `售后工单已解决：${cleanedNote}` : "售后工单已解决",
    metadata: {
      afterSalesStatus: "resolved" satisfies AfterSalesStatus,
      handlerId: handler.id,
      handlerName: handler.name,
      note: cleanedNote ?? null,
    },
    actorId: handler.id,
    actorName: handler.name,
    actorRole: "admin",
  });

  // 通知 customer
  await notifyCustomerByPhone({
    customerPhone: order.customerPhone,
    orderId,
    type: "after_sales_resolved",
    title: "售后已解决",
    content: cleanedNote
      ? `您的售后（订单 ${orderId}）已解决：${cleanedNote}。如需退款请联系客服。`
      : `您的售后（订单 ${orderId}）已解决。如需退款请联系客服。`,
  });

  return { ok: true, orderId, afterSalesStatus: "resolved" };
}

// ============================================================
// 核心函数 4: reject — admin 拒绝
// ============================================================

/**
 * 拒绝售后（admin 在 admin 后台点"拒绝"）。
 *
 * 业务规则：
 * - 订单必须存在
 * - 当前 afterSalesStatus 必须是 "pending" 或 "processing"
 * - reject reason 必填（任务 21 决策 #4）— UI + 函数都强校验
 *
 * 副作用：
 * - 写 afterSalesStatus = "rejected" + afterSalesRejectReason
 * - 写 ActivityLog action="after_sales_rejected"
 * - 通知 customer："售后被拒绝（附原因）"
 */
export async function reject(
  orderId: string,
  rejectReason: string,
  handler: { id: string; name: string },
): Promise<AfterSalesResult> {
  // 1. reject reason 校验（必填）
  const reasonR = validateRejectReason(rejectReason);
  if (!reasonR.ok) {
    return { ok: false, category: "validation", error: reasonR.error };
  }
  const cleanedReason = reasonR.cleaned;

  // 2. 加载订单
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return {
      ok: false,
      category: "validation",
      error: `订单 ${orderId} 不存在`,
    };
  }

  // 3. 状态校验 — pending / processing 都可 reject
  const current = order.afterSalesStatus as AfterSalesStatus | null;
  if (current !== "pending" && current !== "processing") {
    return {
      ok: false,
      category: "validation",
      error:
        current === null
          ? "该订单未发起售后"
          : `当前售后状态为「${current}」，已是终态`,
    };
  }

  // 4. 乐观锁：从原状态转移
  const handledAt = new Date();
  const result = await prisma.order.updateMany({
    where: { id: orderId, afterSalesStatus: current },
    data: {
      afterSalesStatus: "rejected",
      afterSalesRejectReason: cleanedReason,
      afterSalesHandledBy: handler.id,
      afterSalesHandledAt: handledAt,
    },
  });
  if (result.count === 0) {
    return {
      ok: false,
      category: "validation",
      error: "售后状态已被其它操作改变，请刷新后重试",
    };
  }

  // 5. 副作用
  logInfo("after sales rejected", {
    orderId,
    handlerId: handler.id,
    reason: cleanedReason,
  });
  incrementCounter(METRIC.AFTER_SALES_REJECTED, { orderId });

  await createActivityLog({
    action: "after_sales_rejected",
    targetType: "order",
    targetId: orderId,
    message: `售后工单已拒绝：${cleanedReason}`,
    metadata: {
      afterSalesStatus: "rejected" satisfies AfterSalesStatus,
      rejectReason: cleanedReason,
      fromStatus: current,
      handlerId: handler.id,
      handlerName: handler.name,
    },
    actorId: handler.id,
    actorName: handler.name,
    actorRole: "admin",
  });

  // 通知 customer — 附拒绝原因
  await notifyCustomerByPhone({
    customerPhone: order.customerPhone,
    orderId,
    type: "after_sales_rejected",
    title: "售后被拒绝",
    content: `您的售后（订单 ${orderId}）被拒绝：${cleanedReason}`,
  });

  return { ok: true, orderId, afterSalesStatus: "rejected" };
}

// ============================================================
// 读：仅查（admin 列表 / 详情页用）
// ============================================================

/** 给 admin 后台 - 售后工单列表用的查询参数 */
export interface ListAfterSalesFilter {
  status?: AfterSalesStatus | "all";
  page?: number;
  pageSize?: number;
}

/**
 * 按状态统计售后工单数量（dashboard 统计卡用）
 *
 * 只数 afterSalesStatus IS NOT NULL 的订单（即已发起的售后）
 */
export async function countAfterSalesByStatus(): Promise<
  Record<AfterSalesStatus | "all", number>
> {
  const rows = await prisma.order.groupBy({
    by: ["afterSalesStatus"],
    where: { afterSalesStatus: { not: null } },
    _count: { _all: true },
  });
  const result: Record<AfterSalesStatus | "all", number> = {
    all: 0,
    pending: 0,
    processing: 0,
    resolved: 0,
    rejected: 0,
  };
  for (const r of rows) {
    if (r.afterSalesStatus === null) continue;
    const s = r.afterSalesStatus as AfterSalesStatus;
    result.all += r._count._all;
    result[s] += r._count._all;
  }
  return result;
}

/**
 * 查售后工单列表（admin 后台）。
 *
 * 设计：
 * - 仅查 afterSalesStatus IS NOT NULL（即已发起售后的订单）
 * - 按 createdAt desc（最近发起的在最上）+ id tiebreaker
 * - 内联 4 级地址 + SKU 名做展示（admin 一眼看到订单摘要）
 */
export async function listAfterSalesTickets(
  filter: ListAfterSalesFilter = {},
): Promise<{
  tickets: Array<{
    orderId: string;
    afterSalesStatus: AfterSalesStatus;
    afterSalesReason: string | null;
    afterSalesRejectReason: string | null;
    afterSalesHandledAt: Date | null;
    customerName: string;
    customerPhone: string;
    serviceName: string;
    amount: number;
    createdAt: Date;
  }>;
  totalCount: number;
}> {
  const { status = "all", page = 1, pageSize = 20 } = filter;

  const where: Record<string, unknown> = {
    afterSalesStatus: { not: null },
  };
  if (status !== "all") {
    where.afterSalesStatus = status;
  }

  const skip = (page - 1) * pageSize;
  const [rows, totalCount] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        serviceName: true,
        amount: true,
        afterSalesStatus: true,
        afterSalesReason: true,
        afterSalesRejectReason: true,
        afterSalesHandledAt: true,
        createdAt: true,
      },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    tickets: rows.map((r) => ({
      orderId: r.id,
      afterSalesStatus: r.afterSalesStatus as AfterSalesStatus,
      afterSalesReason: r.afterSalesReason,
      afterSalesRejectReason: r.afterSalesRejectReason,
      afterSalesHandledAt: r.afterSalesHandledAt,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      serviceName: r.serviceName,
      amount: r.amount,
      createdAt: r.createdAt,
    })),
    totalCount,
  };
}

/** 取单笔订单的售后状态详情（3 端订单详情页用） */
export async function getAfterSalesByOrderId(orderId: string): Promise<{
  afterSalesStatus: AfterSalesStatus | null;
  afterSalesReason: string | null;
  afterSalesRejectReason: string | null;
  afterSalesHandledBy: string | null;
  afterSalesHandledAt: Date | null;
} | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      afterSalesStatus: true,
      afterSalesReason: true,
      afterSalesRejectReason: true,
      afterSalesHandledBy: true,
      afterSalesHandledAt: true,
    },
  });
  if (!order || order.afterSalesStatus === null) return null;
  return {
    afterSalesStatus: order.afterSalesStatus as AfterSalesStatus,
    afterSalesReason: order.afterSalesReason,
    afterSalesRejectReason: order.afterSalesRejectReason,
    afterSalesHandledBy: order.afterSalesHandledBy,
    afterSalesHandledAt: order.afterSalesHandledAt,
  };
}

// ============================================================
// 通知辅助（fire-and-forget）
// ============================================================

interface AfterSalesNotifyType {
  orderId: string;
  // [修 bug] 必须传 customerPhone 给 notifyCustomerByPhone —
  // 不能用 n.orderId 当 phone 查（phone ≠ orderId）
  customerPhone: string;
  type:
    | "after_sales_pending"
    | "after_sales_processing"
    | "after_sales_resolved"
    | "after_sales_rejected";
  title: string;
  content: string;
}

/** 通知所有 admin 用户（按 role 查） */
async function notifyAdmins(n: AfterSalesNotifyType): Promise<number> {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "admin" },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        createNotification({
          userId: a.id,
          role: "admin",
          // [修 bug] 用扩展后的 after_sales_pending type — admin 收到的通知 type 真实
          type: "after_sales_pending",
          title: n.title,
          content: n.content,
          orderId: n.orderId,
          metadata: { afterSalesType: n.type },
        }),
      ),
    );
    return admins.length;
  } catch (e) {
    logError(`[after-sales] admin 通知失败（已吞掉）`, e, {
      orderId: n.orderId,
    });
    return 0;
  }
}

/** 按 phone 通知 customer（演示期 phone 必填于 seed） */
async function notifyCustomerByPhone(n: AfterSalesNotifyType): Promise<void> {
  try {
    // [修 bug] 必须用「订单的 customerPhone 匹配 user.phone」 — 原占位
    // 「phone contains orderId」永远查不到（phone 不含订单号）
    // 演示期：seed 里 customer 用户的 phone 与订单 customerPhone 是同一字段；
    // 找不到时安静跳过（fire-and-forget）
    if (!n.customerPhone) return;
    const cust = await prisma.user.findFirst({
      where: { phone: n.customerPhone, role: "customer" },
      select: { id: true },
    });
    if (cust) {
      await createNotification({
        userId: cust.id,
        role: "customer",
        // [修 bug] 用扩展后的 after_sales_* type — 不用 order_paid 占位
        type: n.type,
        title: n.title,
        content: n.content,
        orderId: n.orderId,
        metadata: { afterSalesType: n.type },
      });
    }
  } catch (e) {
    logError(`[after-sales] customer 通知失败（已吞掉）`, e, {
      orderId: n.orderId,
    });
  }
}
