// 站内通知工具 — [任务 19] 2026-07-03 引入。
//
// 设计：
// - dispatchOrderNotifications(order, type)：5 关键节点统一入口
//   → 自动给 customer / worker / merchant 三方发通知（按各自 user 关联）
//   → fire-and-forget：失败不抛错，不影响主业务（模仿 activity-log）
// - listNotificationsForUser / countUnreadForUser：列表 + 未读数（bell 红点）
// - markRead / markAllRead：标记已读（防越权 — 强绑 userId）
//
// # MVP: 不做推送/邮件/短信；只做站内；不删已读；不做订阅

import { prisma } from "./db";
import { logInfo, logError } from "./logger";

// ============================================================
// 通知类型 + 角色
// ============================================================

export type NotificationType =
  | "order_paid" // 客户支付成功
  | "order_assigned" // 派单成功
  | "order_completed" // 服务完成
  | "order_canceled" // 订单取消
  | "order_refunded" // 售后退款
  // [任务 21] 售后工单 — 4 状态 → 4 通知类型
  // 文案独立：售后通知带 rejectReason / 处理人 / status，比订单通知更具体
  | "after_sales_pending" // 客户发起 → admin + customer
  | "after_sales_processing" // admin 受理 → customer
  | "after_sales_resolved" // admin 解决 → customer
  | "after_sales_rejected"; // admin 拒绝 → customer（带拒绝理由）

export type NotificationRole = "admin" | "worker" | "customer" | "merchant";

// ============================================================
// 写通知（事务外，fire-and-forget）
// ============================================================

/**
 * 单条通知入参。
 *
 * 关键不变量（CLAUDE.md P0-1）：
 * - 失败必须 try/catch 吞掉，**不能**影响主业务流程
 * - metadata 可空，默认 "{}"
 */
export interface CreateNotificationInput {
  userId: string;
  role: NotificationRole;
  type: NotificationType;
  title: string;
  content: string;
  orderId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 写一条通知。
 * 模仿 activity-log.createActivityLog 的语义：失败仅 console.warn，**不**抛错。
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        role: input.role,
        type: input.type,
        title: input.title,
        content: input.content,
        orderId: input.orderId ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
      },
    });
  } catch (e) {
    logError(`[notification] 写通知失败（已吞掉）`, e, {
      userId: input.userId,
      type: input.type,
      orderId: input.orderId,
    });
  }
}

// ============================================================
// 订单节点 → 三方通知（统一入口）
// ============================================================

/**
 * 5 关键节点触发通知的统一入口。
 *
 * 收信人规则（按用户确认方案）：
 * - 客户: 按 customerPhone 反查 user (role=customer)；发对应 type
 * - 师傅: 按 masterId 反查 Master.user 拿 User.id；按 type 分发
 * - 商家: 按 master.merchantId 反查 user (role=merchant)；发对应 type
 * - admin: 不发（admin 看 ActivityLog，不在通知中心）
 *
 * 设计：
 * - 在业务函数 return 之前 await（一行）；失败 try/catch 吞
 * - 师傅仅 assigned/completed/canceled 收（按用户决策）
 * - 客户和商家全节点收
 */
export interface DispatchOrderContext {
  // 师傅名（用于 content 文案；订单已 load 过 masterName 时直接传，避免再查 DB）
  masterName?: string | null;
  // 金额（分；customer 收支付/退款通知时显示）
  amount?: number;
  // 取消原因（cancel 节点用）
  cancelReason?: string;
}

/**
 * 内部：根据订单反查"应当收通知"的 3 类用户 ID
 *
 * 返回 { customer, worker, merchant }，各自可能 null：
 * - customer=null: phone 查不到对应 customer 账号（演示期 phone 必填于 seed，正常情况非空）
 * - worker=null: 订单未派（pending）；或 master 没绑 worker 账号
 * - merchant=null: 订单未派（pending）；或 master 没 merchantId；或 merchantId 没对应 merchant 账号
 */
interface RecipientIds {
  customer: string | null;
  worker: string | null;
  merchant: string | null;
}

async function resolveRecipients(order: {
  customerPhone: string;
  masterId: string | null;
}): Promise<RecipientIds> {
  const result: RecipientIds = {
    customer: null,
    worker: null,
    merchant: null,
  };

  // 客户：按 phone 查 customer 账号
  if (order.customerPhone) {
    const cust = await prisma.user.findFirst({
      where: { phone: order.customerPhone, role: "customer" },
      select: { id: true },
    });
    result.customer = cust?.id ?? null;
  }

  // 师傅：按 masterId 查 master.user
  if (order.masterId) {
    const m = await prisma.master.findUnique({
      where: { id: order.masterId },
      select: {
        merchantId: true,
        user: { select: { id: true } },
      },
    });
    result.worker = m?.user?.id ?? null;

    // 商家：按 master.merchantId 查 merchant 账号
    if (m?.merchantId) {
      const merch = await prisma.user.findFirst({
        where: { merchantId: m.merchantId, role: "merchant" },
        select: { id: true },
      });
      result.merchant = merch?.id ?? null;
    }
  }

  return result;
}

/**
 * 5 节点通知分发主函数。
 *
 * 师傅仅收 assigned / completed / canceled（按用户决策）；其他节点 worker=null 跳过。
 * 客户和商家全节点收。
 */
export async function dispatchOrderNotifications(
  order: { id: string; customerPhone: string; masterId: string | null },
  type: NotificationType,
  ctx: DispatchOrderContext = {},
): Promise<void> {
  try {
    const recipients = await resolveRecipients(order);

    // 准备文案
    const orderRef = `订单 ${order.id}`;
    const masterRef = ctx.masterName ? `师傅 ${ctx.masterName}` : "已派师傅";
    const amountText = ctx.amount
      ? `（¥${(ctx.amount / 100).toFixed(2)}）`
      : "";
    const reasonText = ctx.cancelReason ? `：${ctx.cancelReason}` : "";

    // [任务 21] 售后通知不发本通道 — 走 after-sales.ts:createNotification 直写
    // 这里仍要列 4 个售后 key（保持强类型完整），但实际不会被命中
    const titles: Record<NotificationType, string> = {
      order_paid: "订单已支付",
      order_assigned: "订单已派单",
      order_completed: "服务已完成",
      order_canceled: "订单已取消",
      order_refunded: "订单已退款",
      after_sales_pending: "新售后工单",
      after_sales_processing: "售后已被受理",
      after_sales_resolved: "售后已解决",
      after_sales_rejected: "售后被拒绝",
    };

    // 客户文案 — 售后 4 类型占位（本通道不调用；after-sales.ts 自己拼）
    const customerContent: Record<NotificationType, string> = {
      order_paid: `您的订单 ${order.id} 已支付成功${amountText}，等待派单`,
      order_assigned: `您的订单 ${order.id} 已派给${masterRef}，请保持电话畅通`,
      order_completed: `您的订单 ${order.id} 服务已完成${ctx.masterName ? `（${ctx.masterName}）` : ""}`,
      order_canceled: `您的订单 ${order.id} 已取消${reasonText}`,
      order_refunded: `您的订单 ${order.id} 已退款${amountText}`,
      after_sales_pending: `您的售后申请已提交（订单 ${order.id}）`,
      after_sales_processing: `您的售后（订单 ${order.id}）已被受理`,
      after_sales_resolved: `您的售后（订单 ${order.id}）已解决`,
      after_sales_rejected: `您的售后（订单 ${order.id}）被拒绝`,
    };

    // 师傅文案（按 type 分）— 售后师傅不收
    const workerContent: Partial<Record<NotificationType, string>> = {
      order_assigned: `您有一个新任务：订单 ${order.id}`,
      order_completed: `您已完成订单 ${order.id}`,
      order_canceled: `订单 ${order.id} 已被取消${reasonText}`,
    };

    // 商家文案 — 售后商家不收本通道
    const merchantContent: Record<NotificationType, string> = {
      order_paid: `本商家区域订单 ${order.id} 已支付${amountText}，等待派单`,
      order_assigned: `订单 ${order.id} 已派给${masterRef}`,
      order_completed: `${ctx.masterName ?? "本商家师傅"}完成了订单 ${order.id}`,
      order_canceled: `订单 ${order.id} 已被取消${reasonText}`,
      order_refunded: `订单 ${order.id} 已退款${amountText}`,
      after_sales_pending: `订单 ${order.id} 发起售后`,
      after_sales_processing: `订单 ${order.id} 售后处理中`,
      after_sales_resolved: `订单 ${order.id} 售后已解决`,
      after_sales_rejected: `订单 ${order.id} 售后被拒绝`,
    };

    // 写 3 条通知（fire-and-forget，createNotification 内部 try/catch 吞错）
    if (recipients.customer) {
      await createNotification({
        userId: recipients.customer,
        role: "customer",
        type,
        title: titles[type],
        content: customerContent[type],
        orderId: order.id,
        metadata: {
          amount: ctx.amount,
          masterName: ctx.masterName,
          cancelReason: ctx.cancelReason,
        },
      });
    }

    if (recipients.worker && workerContent[type]) {
      await createNotification({
        userId: recipients.worker,
        role: "worker",
        type,
        title: titles[type],
        content: workerContent[type] as string,
        orderId: order.id,
        metadata: {
          masterName: ctx.masterName,
          cancelReason: ctx.cancelReason,
        },
      });
    }

    if (recipients.merchant) {
      await createNotification({
        userId: recipients.merchant,
        role: "merchant",
        type,
        title: titles[type],
        content: merchantContent[type],
        orderId: order.id,
        metadata: {
          amount: ctx.amount,
          masterName: ctx.masterName,
          cancelReason: ctx.cancelReason,
        },
      });
    }

    logInfo("notification dispatched", {
      orderId: order.id,
      type,
      customer: !!recipients.customer,
      worker: !!recipients.worker,
      merchant: !!recipients.merchant,
    });
  } catch (e) {
    // 整体失败不抛错（fire-and-forget）
    logError(`[notification] dispatchOrderNotifications 失败（已吞掉）`, e, {
      orderId: order.id,
      type,
    });
  }
}

// ============================================================
// 读通知（列表 + 未读数 + 已读）
// ============================================================

export interface ListNotificationsFilter {
  /** 仅未读（默认 false = 全部）*/
  unreadOnly?: boolean;
  /** 类型过滤 */
  type?: NotificationType;
  /** 分页 */
  page?: number;
  pageSize?: number;
}

export interface ListNotificationsResult {
  notifications: Array<{
    id: string;
    role: string;
    type: string;
    title: string;
    content: string;
    orderId: string | null;
    readAt: Date | null;
    createdAt: Date;
    metadata: Record<string, unknown>;
  }>;
  totalCount: number;
  unreadCount: number;
}

/**
 * 读某用户的通知列表（按 createdAt desc，加 id tiebreaker 防同秒数据漂移）。
 *
 * 越权防控：userId 是必传参数（从 session 取），不在 filter 里；query 永远按 userId 过滤
 * 防 listAll 之类的越权查询。
 */
export async function listNotificationsForUser(
  userId: string,
  filter: ListNotificationsFilter = {},
): Promise<ListNotificationsResult> {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const where: Record<string, unknown> = { userId };
  if (filter.unreadOnly) where.readAt = null;
  if (filter.type) where.type = filter.type;

  const skip = (page - 1) * pageSize;
  const [rows, totalCount, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    notifications: rows.map((n) => ({
      id: n.id,
      role: n.role,
      type: n.type,
      title: n.title,
      content: n.content,
      orderId: n.orderId,
      readAt: n.readAt,
      createdAt: n.createdAt,
      metadata: JSON.parse(n.metadata) as Record<string, unknown>,
    })),
    totalCount,
    unreadCount,
  };
}

/** 仅取未读数（给 header bell 红点用）*/
export async function countUnreadForUser(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, readAt: null },
  });
}

// ============================================================
// 标记已读（越权防控：必须 own userId）
// ============================================================

export type MarkReadResult =
  { ok: true; notificationId: string } | { ok: false; error: string };

/**
 * 标记单条已读。
 *
 * 越权防控：where 同时带 id + userId（防用户 A 标记用户 B 的通知）
 * 幂等：再次标记返回 ok（不影响主流程）
 */
export async function markRead(
  notificationId: string,
  userId: string,
): Promise<MarkReadResult> {
  if (!notificationId) {
    return { ok: false, error: "缺少 notificationId" };
  }
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId }, // 越权兜底
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    // 不存在 / 已读 / 越权 — 3 种情况合一返回（不暴露细节给客户端）
    return { ok: false, error: "通知不存在或已标记" };
  }
  return { ok: true, notificationId };
}

/**
 * 标记当前用户所有未读为已读。
 * 幂等；返回标记条数。
 */
export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
