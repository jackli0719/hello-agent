"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  assignOrder,
  createOrder,
  transitionOrder,
  type AssignOrderResult,
  type CreateOrderResult,
  type TransitionOrderResult,
} from "@/src/lib/orders";
import { releaseMaster, ReleaseOrderError } from "@/src/lib/repos/orders";
import { createActivityLog } from "@/src/lib/activity-log";

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

/**
 * 新建订单 server action。
 * 接 FormData（前端 form action 直接传整个 form），调用 src/lib/orders.ts 的 createOrder。
 * 成功 → revalidate + redirect /orders
 * 失败 → 返回结构化错误给 UI 内联展示
 */
export async function createOrderAction(
  formData: FormData,
): Promise<CreateOrderActionResult | null> {
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();

  const amount = Number(amountRaw);
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : new Date(NaN);

  const result = await createOrder({
    customerName: String(formData.get("customerName") ?? ""),
    customerPhone: String(formData.get("customerPhone") ?? ""),
    address: String(formData.get("address") ?? ""),
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
  try {
    const order = await releaseMaster(orderId, "cancelled");
    // 写操作日志
    await createActivityLog({
      action: "order_canceled",
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
): Promise<TransitionActionResult> {
  const result = await transitionOrder(orderId, nextStatus);
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
  return runTransition(orderId, "in_service", "开始服务");
}

/**
 * 「完成订单」— in_service → completed。
 * [v0.7.6] 可选 serviceSummary：师傅填的服务完成说明。
 */
export async function completeOrderAction(
  orderId: string,
  serviceSummary?: string,
): Promise<TransitionActionResult> {
  // [v0.7.6] 先写 serviceSummary（独立 update；空字符串不写）
  if (serviceSummary && serviceSummary.trim()) {
    try {
      const { prisma } = await import("@/src/lib/db");
      await prisma.order.update({
        where: { id: orderId },
        data: { serviceSummary: serviceSummary.trim() },
      });
      // 写活动日志
      const { createActivityLog } = await import("@/src/lib/activity-log");
      const { getCurrentUser } = await import("@/src/lib/auth");
      const user = await getCurrentUser();
      await createActivityLog({
        action: "order_service_summary_added",
        targetType: "order",
        targetId: orderId,
        message: `师傅${user?.name ?? ""}填写了订单 ${orderId} 的服务完成说明`,
        actorId: user?.id ?? null,
        actorName: user?.name ?? "unknown",
        actorRole:
          (user?.role as "admin" | "worker" | "customer" | "system") ??
          "system",
        metadata: { serviceSummary: serviceSummary.trim() },
      });
    } catch (e) {
      // 写失败不阻塞主流程
      console.warn(
        `[completeOrderAction] serviceSummary 写失败: ${(e as Error).message}`,
      );
    }
  }

  const result = await runTransition(orderId, "completed", "完成订单");
  return result;
}

/**
 * 「取消订单」— pending/assigned/in_service → cancelled。
 * 事务里同时释放师傅（如果有）。
 */
export async function cancelOrderAction(
  orderId: string,
): Promise<TransitionActionResult> {
  return runTransition(orderId, "cancelled", "取消订单");
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
  if (!user || user.role !== "admin") {
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
