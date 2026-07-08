"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  assignOrder,
  createOrder,
  transitionOrder,
  refundOrder,
  type AssignOrderResult,
  type CreateOrderResult,
  type TransitionOrderResult,
  type RefundOrderResult,
} from "@/src/lib/orders";
import { releaseMaster, ReleaseOrderError } from "@/src/lib/repos/orders";
import { createActivityLog } from "@/src/lib/activity-log";
import { prisma } from "@/src/lib/db";
import {
  tryAutoDispatch,
  type AutoDispatchResult,
} from "@/src/lib/auto-dispatch";
import {
  CSRF_FORM_FIELD,
  verifyCsrfOrigin,
  verifyCsrfToken,
} from "@/src/lib/csrf";
import {
  requireAdmin,
  requireCsrf,
  requireWorker,
  requireRole,
} from "@/src/lib/auth-helpers";

// 失败时返回的判别联合 — 成功路径通过 redirect 走，函数本身不返回。
export type CreateOrderActionResult = Exclude<CreateOrderResult, { ok: true }>;

// 派单失败时返回的判别联合 — 成功时返回 assigned=true 让 UI 给反馈
export type AssignOrderActionResult =
  AssignOrderResult | { ok: true; orderId: string; masterName: string };

// 「取消派单」action 返回值
export type CancelDispatchActionResult =
  | { ok: true; orderId: string; masterName: string | null }
  | { ok: false; category: "validation" | "system"; error: string };

// 状态流转 action 返回值 — 三个 action 通用
export type TransitionActionResult =
  | Exclude<TransitionOrderResult, { ok: true }>
  | { ok: true; orderId: string; nextStatus: string };

// [任务 19] 退款 action 返回值（与 src/lib/orders.ts 的 RefundOrderResult 一致）
export type RefundActionResult = RefundOrderResult;

/**
 * 新建订单 server action。
 * 接 FormData（前端 form action 直接传整个 form），调用 src/lib/orders.ts 的 createOrder。
 * 成功 → revalidate + redirect /orders
 * 失败 → 返回结构化错误给 UI 内联展示
 */
export async function createOrderAction(
  formData: FormData,
): Promise<CreateOrderActionResult | null> {
  // [v0.9.4] P0 鉴权收口：admin + csrf
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }
  const csrf = await requireCsrf(formData);
  if (!csrf.ok) {
    return { ok: false, error: csrf.error };
  }

  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();

  const amount = Number(amountRaw);
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : new Date(NaN);

  const result = await createOrder({
    customerName: String(formData.get("customerName") ?? ""),
    customerPhone: String(formData.get("customerPhone") ?? ""),
    // [任务 3] 4 级地址 — 拼成 address 展示冗余
    address:
      [
        String(formData.get("province") ?? "").trim(),
        String(formData.get("city") ?? "").trim(),
        String(formData.get("district") ?? "").trim(),
        String(formData.get("street") ?? "").trim(),
        String(formData.get("addressDetail") ?? "").trim(),
      ]
        .filter(Boolean)
        .join("") || String(formData.get("address") ?? ""),
    // [任务 3] 4 级地址字段
    province: String(formData.get("province") ?? ""),
    city: String(formData.get("city") ?? ""),
    district: String(formData.get("district") ?? ""),
    street: String(formData.get("street") ?? ""),
    addressDetail: String(formData.get("addressDetail") ?? ""),
    skuCode: String(formData.get("skuCode") ?? ""),
    // categoryCode 用于服务端配对校验（前端 select 联动时同步提交）
    categoryCode: String(formData.get("categoryCode") ?? "") || undefined,
    amount,
    scheduledAt,
    // remark 可选 — 后台表单如果有就传（用户端 MVP 也用这个 action 层）
    remark: String(formData.get("remark") ?? "") || undefined,
  });

  if (!result.ok) {
    return result;
  }

  // 写操作日志（失败不影响主流程）
  const customerName = String(formData.get("customerName") ?? "");
  await createActivityLog({
    action: "order_created",
    targetType: "order",
    targetId: result.orderId,
    message: `用户 ${customerName} 创建了订单 ${result.orderId}`,
    metadata: {
      skuCode: String(formData.get("skuCode") ?? ""),
      customerPhone: String(formData.get("customerPhone") ?? ""),
      amount,
    },
  });

  try {
    revalidatePath("/orders");
    revalidatePath("/");
  } catch {
    // 单测环境无 Next runtime
  }

  redirect(`/orders?created=${encodeURIComponent(result.orderId)}`);
}

/**
 * 派单 server action。
 *
 * 流程：
 * 1. 调 src/lib/orders.ts 的 assignOrder(orderId, masterId)
 *    - 服务端独立校验：订单 pending / 师傅 available / 师傅在候选人里
 *    - 事务里改两边
 * 2. 成功 → revalidate /orders 让页面拿到新数据
 * 3. 失败 → 返回结构化错误（区分 validation / system）
 *
 * 重要：success 时返回 ok:true 而不是 redirect — 派单不需要跳页，
 * 直接 revalidate 刷新当前列表更符合「在表格行内操作」的体验。
 */
export async function assignOrderAction(
  orderId: string,
  masterId: string,
): Promise<AssignOrderActionResult> {
  // [v0.9.4] P0 鉴权收口：admin
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }
  // [v0.9.7] P0 CSRF：非 FormData action 用 Origin 头校验
  const csrf = await verifyCsrfOrigin();
  if (!csrf.ok) {
    return { ok: false, category: "validation", error: csrf.error };
  }

  const result = await assignOrder(orderId, masterId);

  if (result.ok) {
    // 写操作日志
    await createActivityLog({
      action: "order_assigned",
      targetType: "order",
      targetId: result.orderId,
      message: `管理员将订单 ${result.orderId} 派给师傅 ${result.masterName}`,
      metadata: { masterId, masterName: result.masterName },
    });

    try {
      revalidatePath("/orders");
      revalidatePath("/");
    } catch {
      // 单测环境无 Next runtime
    }
    return { ok: true, orderId: result.orderId, masterName: result.masterName };
  }

  return result;
}

/**
 * 「取消派单」server action — 把订单从 assigned/in_service 退回 pending，
 * 师傅从 busy 退回 available。
 *
 * 范围：本阶段**只**实现「取消派单」，不实现「订单完成」或「订单取消」
 * 这两个状态流转动作（releaseOrderAction 里 status='completed' 的路径保留
 * 作为未来入口）。
 *
 * 复用 src/lib/repos/orders.ts 的 releaseMaster — 它已带校验、事务、并发兜底。
 */
export async function cancelDispatchAction(
  orderId: string,
): Promise<CancelDispatchActionResult> {
  // [v0.9.4] P0 鉴权收口：admin
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }
  // [v0.9.7] P0 CSRF：Origin 头校验
  const csrf = await verifyCsrfOrigin();
  if (!csrf.ok) {
    return { ok: false, category: "validation", error: csrf.error };
  }

  try {
    const order = await releaseMaster(orderId, "cancelled");
    // 写操作日志
    await createActivityLog({
      action: "order_dispatch_canceled", // [v0.7.9] 跟 order_canceled 区分
      targetType: "order",
      targetId: order.id,
      message: order.technicianName
        ? `管理员取消了订单 ${order.id}（已释放师傅 ${order.technicianName}）`
        : `管理员取消了订单 ${order.id}`,
      metadata: {
        reason: "cancel_dispatch",
        technicianName: order.technicianName,
      },
    });

    try {
      revalidatePath("/orders");
      revalidatePath("/");
    } catch {
      // 单测环境无 Next runtime
    }
    return {
      ok: true,
      orderId: order.id,
      masterName: order.technicianName, // 释放前的师傅名（snapshot）
    };
  } catch (e) {
    if (e instanceof ReleaseOrderError) {
      return { ok: false, category: "validation", error: e.reason };
    }
    return { ok: false, category: "system", error: "取消派单失败，请稍后再试" };
  }
}

// ============================================================
// 状态流转 actions
// ============================================================

async function runTransition(
  orderId: string,
  nextStatus: "in_service" | "completed" | "cancelled",
  friendlyName: string,
  // [v0.7.8] 可选 serviceSummary：透传给 transitionOrder 在事务内写
  serviceSummary?: string,
  // [v0.7.9] 可选 cancelReason：透传给 transitionOrder 在事务内写
  cancelReason?: string,
): Promise<TransitionActionResult> {
  const result = await transitionOrder(
    orderId,
    nextStatus,
    serviceSummary,
    cancelReason,
  );
  if (result.ok) {
    // 写操作日志（按目标状态分支 action 类型）
    const actionMap = {
      in_service: "service_started",
      completed: "order_completed",
      cancelled: "order_canceled",
    } as const;
    const actionLabelMap = {
      in_service: `师傅 ${result.masterName ?? ""} 开始服务订单 ${result.orderId}`,
      completed: `师傅 ${result.masterName ?? ""} 完成订单 ${result.orderId}`,
      cancelled: `订单 ${result.orderId} 被取消`,
    } as const;
    await createActivityLog({
      action: actionMap[nextStatus],
      targetType: "order",
      targetId: result.orderId,
      message: actionLabelMap[nextStatus],
      metadata: {
        fromStatus: result.fromStatus,
        toStatus: nextStatus,
        masterName: result.masterName,
      },
    });

    // [v0.7.9] 取消订单 → 单独埋日志（含原因）
    if (nextStatus === "cancelled" && cancelReason && cancelReason.trim()) {
      await createActivityLog({
        action: "order_canceled",
        targetType: "order",
        targetId: result.orderId,
        message: `订单 ${result.orderId} 被取消：${cancelReason.trim()}`,
        metadata: { cancelReason: cancelReason.trim() },
      });
    }

    // [v0.7.8] 师傅填了 serviceSummary → 单独埋日志
    // （serviceSummary 数据已写在 transitionOrder 事务里；这里只记录活动）
    if (nextStatus === "completed" && serviceSummary && serviceSummary.trim()) {
      await createActivityLog({
        action: "order_service_summary_added",
        targetType: "order",
        targetId: result.orderId,
        message: `师傅${result.masterName ?? ""}填写了订单 ${result.orderId} 的服务完成说明`,
        metadata: { serviceSummary: serviceSummary.trim() },
      });
    }

    try {
      revalidatePath("/orders");
      revalidatePath("/");
    } catch {
      // 单测无 Next runtime
    }
    return { ok: true, orderId: result.orderId, nextStatus: result.nextStatus };
  }
  // 把 transitionOrder 的 ok:false 翻译成 UI 友好的错误
  if (result.category === "validation") {
    return { ok: false, category: "validation", error: result.error };
  }
  return {
    ok: false,
    category: "system",
    error: `${friendlyName}失败，请稍后再试`,
  };
}

/**
 * 「开始服务」— assigned → in_service。
 */
export async function startServiceAction(
  orderId: string,
): Promise<TransitionActionResult> {
  // [v0.9.4] P0 鉴权收口：admin
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }
  // [v0.9.7] P0 CSRF：Origin 头校验
  const csrf = await verifyCsrfOrigin();
  if (!csrf.ok) {
    return { ok: false, category: "validation", error: csrf.error };
  }
  return runTransition(orderId, "in_service", "开始服务");
}

/**
 * 「完成订单」— in_service → completed。
 * [v0.7.6] 可选 serviceSummary：师傅填的服务完成说明。
 * [v0.7.8] serviceSummary 与 status 在同事务内写（原子性）。
 */
export async function completeOrderAction(
  orderId: string,
  serviceSummary?: string,
): Promise<TransitionActionResult> {
  // [v0.9.4] P0 鉴权收口：admin
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }
  // [v0.9.7] P0 CSRF：Origin 头校验
  const csrf = await verifyCsrfOrigin();
  if (!csrf.ok) {
    return { ok: false, category: "validation", error: csrf.error };
  }
  // [v0.7.8] serviceSummary 写在 transitionOrder 内部（同事务）
  const result = await runTransition(
    orderId,
    "completed",
    "完成订单",
    serviceSummary,
  );
  return result;
}

/**
 * 「取消订单」— pending/assigned/in_service → cancelled。
 * 事务里同时释放师傅（如果有）。
 */
export async function cancelOrderAction(
  orderId: string,
  cancelReason?: string,
): Promise<TransitionActionResult> {
  // [v0.9.4] P0 鉴权收口：admin
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }
  // [v0.9.7] P0 CSRF：Origin 头校验
  const csrf = await verifyCsrfOrigin();
  if (!csrf.ok) {
    return { ok: false, category: "validation", error: csrf.error };
  }
  return runTransition(
    orderId,
    "cancelled",
    "取消订单",
    undefined,
    cancelReason,
  );
}

/**
 * [v0.7.6] 「更新内部备注」— admin 专属。
 * 内部备注只后台可见，user/worker 端不展示。
 * Activity Log 记录：order_internal_remark_updated
 */
export type UpdateInternalRemarkResult =
  { ok: true } | { ok: false; error: string };

export async function updateInternalRemarkAction(
  formData: FormData,
): Promise<UpdateInternalRemarkResult> {
  // [v0.9.4] P0 鉴权收口：admin
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }
  // [v0.7.7] CSRF 校验（修 ADR-013 B6 同类 v0.7.2 logout bug）
  const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
  if (!(await verifyCsrfToken(csrfToken))) {
    return { ok: false, error: "会话已过期，请刷新页面后重试" };
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  const internalRemark = String(formData.get("internalRemark") ?? "").trim();

  if (!orderId) {
    return { ok: false, error: "缺少订单 id" };
  }
  if (internalRemark.length > 500) {
    return { ok: false, error: "内部备注不能超过 500 个字符" };
  }

  // 权限检查：必须是 admin（middleware 已挡；这里兜底）
  const { getCurrentUser } = await import("@/src/lib/auth");
  const user = await getCurrentUser();
  if (!user) {
    // [v0.7.10] 中间过渡：旧 cookie 兼容（v0.6.0 之前 session 格式是 "1"）
    return { ok: false, error: "请重新登录后再操作" };
  }
  if (user.role !== "admin") {
    return { ok: false, error: "仅管理员可编辑内部备注" };
  }

  try {
    const { prisma } = await import("@/src/lib/db");
    await prisma.order.update({
      where: { id: orderId },
      data: { internalRemark: internalRemark || null },
    });

    // 写活动日志
    const { createActivityLog } = await import("@/src/lib/activity-log");
    await createActivityLog({
      action: "order_internal_remark_updated",
      targetType: "order",
      targetId: orderId,
      message: internalRemark
        ? `管理员更新了订单 ${orderId} 的内部备注`
        : `管理员清空了订单 ${orderId} 的内部备注`,
      actorId: user.id,
      actorName: user.name,
      actorRole: "admin",
      metadata: { internalRemark },
    });

    try {
      const { revalidatePath } = await import("next/cache");
      revalidatePath("/orders");
    } catch {
      // 单测无 Next runtime
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * [v0.7.9] 师傅取消订单 — 师傅专属
 * 业务规则：assigned / in_service 状态可取消（completed/cancelled 不允许）
 * in_service 必须填原因（业务规则 #5 + ADR-013 简洁版本）
 */
export async function workerCancelOrderAction(
  formData: FormData,
): Promise<TransitionActionResult> {
  // [v0.9.4] P0 鉴权收口：worker（v0.9.6 组 3 加 masterId 归属校验）
  const auth = await requireWorker();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }
  // [v0.7.9] CSRF 校验（防 v0.7.2/v0.7.7 同类 bug）
  const { CSRF_FORM_FIELD, verifyCsrfToken } = await import("@/src/lib/csrf");
  const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
  if (!(await verifyCsrfToken(csrfToken))) {
    return {
      ok: false,
      category: "validation",
      error: "会话已过期，请刷新页面后重试",
    };
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  const cancelReason = String(formData.get("cancelReason") ?? "").trim();
  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少订单 id" };
  }
  // 权限 + 状态校验：必须是该师傅的订单
  const { getCurrentUser } = await import("@/src/lib/auth");
  const user = await getCurrentUser();
  if (!user) {
    // [v0.7.10] 中间过渡：旧 cookie 兼容
    return { ok: false, category: "validation", error: "请重新登录后再操作" };
  }
  if (user.role !== "worker" || !user.workerId) {
    return { ok: false, category: "validation", error: "仅师傅可调用" };
  }
  // 业务校验：不能取消 completed/cancelled
  const { prisma } = await import("@/src/lib/db");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, masterId: true },
  });
  if (!order) {
    return { ok: false, category: "validation", error: "订单不存在" };
  }
  if (order.masterId !== user.workerId) {
    return { ok: false, category: "validation", error: "该订单不属于您" };
  }
  if (order.status === "completed" || order.status === "cancelled") {
    return {
      ok: false,
      category: "validation",
      error: `订单状态「${order.status}」不允许取消`,
    };
  }
  // in_service 必填原因
  if (order.status === "in_service" && !cancelReason) {
    return {
      ok: false,
      category: "validation",
      error: "服务中的订单必须填写取消原因",
    };
  }

  const result = await runTransition(
    orderId,
    "cancelled",
    "取消订单",
    undefined,
    cancelReason,
  );
  return result;
}

/**
 * [v0.7.9] 用户取消订单 — customer 专属
 * 业务规则：仅 pending 状态可取消（其他状态不允许 — 业务规则 #10）
 */
export async function customerCancelOrderAction(
  formData: FormData,
): Promise<TransitionActionResult> {
  // [v0.9.4] P0 鉴权收口：customer
  const auth = await requireRole(["customer"]);
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }
  // [v0.7.9] CSRF 校验
  const { CSRF_FORM_FIELD, verifyCsrfToken } = await import("@/src/lib/csrf");
  const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
  if (!(await verifyCsrfToken(csrfToken))) {
    return {
      ok: false,
      category: "validation",
      error: "会话已过期，请刷新页面后重试",
    };
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  const cancelReason = String(formData.get("cancelReason") ?? "").trim();
  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少订单 id" };
  }
  // 权限 + 状态校验
  const { getCurrentUser } = await import("@/src/lib/auth");
  const user = await getCurrentUser();
  if (!user) {
    // [v0.7.10] 中间过渡：旧 cookie 兼容
    return { ok: false, category: "validation", error: "请重新登录后再操作" };
  }
  if (user.role !== "customer" || !user.phone) {
    return { ok: false, category: "validation", error: "仅用户可调用" };
  }
  const { prisma } = await import("@/src/lib/db");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, customerPhone: true },
  });
  if (!order) {
    return { ok: false, category: "validation", error: "订单不存在" };
  }
  // 越权防护：必须是自己的订单
  if (order.customerPhone !== user.phone) {
    return { ok: false, category: "validation", error: "该订单不属于您" };
  }
  // 业务规则：仅 pending 状态可取消
  if (order.status !== "pending") {
    return {
      ok: false,
      category: "validation",
      error: `订单状态「${order.status}」不允许取消`,
    };
  }

  const result = await runTransition(
    orderId,
    "cancelled",
    "取消订单",
    undefined,
    cancelReason,
  );
  return result;
}

// ============================================================
// [任务 19] 售后退款 — 仅 completed + payStatus=paid 可走
// ============================================================

/**
 * [任务 19] 客户申请售后退款 — completed 订单发现问题后客户主动申请退款。
 *
 * 规则：
 * - 订单必须属于当前 customer（user.phone === order.customerPhone）
 * - 订单 status 必须 completed + payStatus=paid
 * - 调 src/lib/orders.ts:refundOrder（事务 + 乐观锁）
 */
export async function customerRefundOrderAction(
  formData: FormData,
): Promise<RefundOrderResult> {
  // 鉴权：customer 专属
  const auth = await requireRole(["customer"]);
  if (!auth.ok) {
    return { ok: false, category: "validation", error: auth.error };
  }
  // CSRF 校验
  const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
  if (!(await verifyCsrfToken(csrfToken))) {
    return {
      ok: false,
      category: "validation",
      error: "会话已过期，请刷新页面后重试",
    };
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少 orderId" };
  }

  // 越权防护：customer 只能退自己手机号下的订单
  const { prisma } = await import("@/src/lib/db");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, payStatus: true, customerPhone: true },
  });
  if (!order) {
    return {
      ok: false,
      category: "validation",
      error: `订单 ${orderId} 不存在`,
    };
  }
  if (!auth.user.phone || order.customerPhone !== auth.user.phone) {
    return {
      ok: false,
      category: "validation",
      error: "该订单不属于您",
    };
  }
  if (order.status !== "completed" || order.payStatus !== "paid") {
    return {
      ok: false,
      category: "validation",
      error: `订单当前状态（status=${order.status}, payStatus=${order.payStatus}）不符合售后退款条件`,
    };
  }

  const result = await refundOrder(orderId);
  if (result.ok) {
    try {
      revalidatePath(`/customer/orders/${orderId}`);
      revalidatePath("/customer/orders");
      revalidatePath("/orders"); // 后台订单列表
    } catch {
      // 单测无 Next runtime
    }
  }
  return result;
}

/**
 * [任务 19] admin 代售后退款 — admin 是平台运维，演示期可代任何订单发起售后退款。
 *
 * 业务场景：客户来电要求退款 / 投诉处理 / 风控介入
 * 规则：同 refundOrder — 仅 completed + payStatus=paid 可退
 */
export async function adminRefundOrderAction(
  orderId: string,
): Promise<RefundOrderResult> {
  // 鉴权：admin 专属
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: "validation", error: auth.error };
  }
  // CSRF：非 FormData action 用 Origin 头校验
  const csrf = await verifyCsrfOrigin();
  if (!csrf.ok) {
    return { ok: false, category: "validation", error: csrf.error };
  }

  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少 orderId" };
  }

  const result = await refundOrder(orderId);
  if (result.ok) {
    // 写活动日志（admin 视角 — actorRole=admin，actorName=当前 admin）
    const { getCurrentUser } = await import("@/src/lib/auth");
    const admin = await getCurrentUser();
    await createActivityLog({
      action: "order_refunded",
      targetType: "order",
      targetId: orderId,
      message: `管理员 ${admin?.name ?? ""} 为订单 ${orderId} 发起售后退款`,
      metadata: { operator: admin?.name ?? "admin" },
      actorId: admin?.id,
      actorName: admin?.name ?? "admin",
      actorRole: "admin",
    });
    try {
      revalidatePath("/orders");
    } catch {
      // 单测无 Next runtime
    }
  }
  return result;
}

// ============================================================
// [任务 20] 手动重试自动派单 — admin 专属
// ============================================================

/**
 * [任务 20] admin 手动触发自动派单。
 *
 * 业务场景（CLAUDE.md P0-0 决策 #1 — 双入口之一）：
 * 1. 支付后 tryAutoDispatch 失败（如 area_no_merchant）→ 订单保持 pending + payStatus=paid
 * 2. admin 在 /orders/[id] 看到"派单失败：当前区域暂无商家覆盖"
 * 3. admin 联系商家开通区域 / 新增师傅 / 加规则 → 修复问题
 * 4. admin 点"重新派单"按钮 → 调本 action → 再跑 tryAutoDispatch
 *
 * 规则：
 * - 订单必须存在
 * - 订单 status 必须 === "pending" + payStatus === "paid"（与 assignOrder 一致）
 * - 调 src/lib/auto-dispatch.ts:tryAutoDispatch
 * - CSRF：非 FormData action → verifyCsrfOrigin
 */
export type AutoDispatchActionResult =
  | { ok: true; orderId: string; masterName: string }
  | { ok: false; category: "validation" | "system"; error: string };

export async function adminAutoDispatchAction(
  orderId: string,
): Promise<AutoDispatchActionResult> {
  // 鉴权：admin 专属
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { ok: false, category: "validation", error: auth.error };
  }
  // CSRF：非 FormData action → Origin 头校验
  const csrf = await verifyCsrfOrigin();
  if (!csrf.ok) {
    return { ok: false, category: "validation", error: csrf.error };
  }

  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少 orderId" };
  }

  // 前置校验：订单必须是 pending + paid
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, payStatus: true },
  });
  if (!order) {
    return {
      ok: false,
      category: "validation",
      error: `订单 ${orderId} 不存在`,
    };
  }
  if (order.status !== "pending" || order.payStatus !== "paid") {
    return {
      ok: false,
      category: "validation",
      error: `订单当前状态（status=${order.status}, payStatus=${order.payStatus}）不可自动派单`,
    };
  }

  const result = await tryAutoDispatch(orderId);
  if (result.ok) {
    try {
      revalidatePath("/orders");
      revalidatePath(`/orders/${orderId}`);
    } catch {
      // 单测无 Next runtime
    }
    return { ok: true, orderId, masterName: result.masterName };
  }
  return {
    ok: false,
    category: "validation",
    error: result.reason,
  };
}

// ============================================================
// [任务 21] 售后工单 — 客户发起
// ============================================================

/**
 * [任务 21] 客户发起售后 — 仅 completed 订单可发起；只能操作自己的订单。
 *
 * 业务边界（与 [任务 19] customerRefundOrderAction 区分）：
 * - refundOrder: 直接退钱（已支付 → 已退款）
 * - createAfterSales: 发起问题单（admin 受理后处理，可能 resolved 也可能 rejected）
 * 演示期：两者并存 — 客户可二选一（实际场景一般先售后沟通，处理人同意后才退款）
 *
 * 鉴权：customer 专属 + 越权防护（user.phone === order.customerPhone）
 * CSRF：FormData → verifyCsrfToken
 */
export async function customerCreateAfterSalesAction(
  formData: FormData,
): Promise<
  | { ok: true; orderId: string; afterSalesStatus: "pending" }
  | { ok: false; category: "validation" | "system"; error: string }
> {
  // 鉴权
  const auth = await requireRole(["customer"]);
  if (!auth.ok) {
    return { ok: false, category: "validation", error: auth.error };
  }
  // CSRF
  const csrfToken = String(formData.get(CSRF_FORM_FIELD) ?? "");
  if (!(await verifyCsrfToken(csrfToken))) {
    return {
      ok: false,
      category: "validation",
      error: "会话已过期，请刷新页面后重试",
    };
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少 orderId" };
  }

  // 越权防护：customer 只能对自己的订单发起售后
  const { prisma } = await import("@/src/lib/db");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { customerPhone: true, status: true },
  });
  if (!order) {
    return {
      ok: false,
      category: "validation",
      error: `订单 ${orderId} 不存在`,
    };
  }
  if (!auth.user.phone || order.customerPhone !== auth.user.phone) {
    return { ok: false, category: "validation", error: "该订单不属于您" };
  }
  if (order.status !== "completed") {
    return {
      ok: false,
      category: "validation",
      error: `订单当前状态（status=${order.status}）不能发起售后`,
    };
  }

  const reason = String(formData.get("reason") ?? "").trim();

  // 调 after-sales 业务函数
  const { createTicket } = await import("@/src/lib/after-sales");
  const result = await createTicket(orderId, reason, {
    id: auth.user.id,
    name: auth.user.name,
  });
  if (!result.ok) {
    return { ok: false, category: result.category, error: result.error };
  }
  try {
    revalidatePath(`/customer/orders/${orderId}`);
    revalidatePath("/customer/orders");
  } catch {
    /* 单测无 Next runtime */
  }
  return { ok: true, orderId, afterSalesStatus: "pending" };
}
