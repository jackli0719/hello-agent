"use server";

// [任务 19] 商家端订单操作 server actions
//
// 范围：
// 1. merchantCancelOrderAction — 商家取消本商家师傅接的订单 / 本商家可见区域内的订单
//    （取消后自动联动退款：paid → refunded，事务内一步）
//
// 越权防控（CLAUDE.md P0-1 + 任务 18 数据层零信任）：
// - merchantId 来源唯一 = getCurrentUser().merchantId（不接 form/URL 参数）
// - 订单必须落入本商家可见集合（byMaster 或 byArea）— 用 getEffectiveMerchantId
//   + 二次查 order 关联 master / order 4 级地址确认归属
// - 不接受 "我也能看别人订单" 的请求

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/src/lib/auth";
import { getEffectiveMerchantId } from "@/src/lib/merchant-admin";
import { transitionOrder } from "@/src/lib/orders";
import type { TransitionActionResult } from "@/app/orders/actions";
import { CSRF_FORM_FIELD, verifyCsrfToken } from "@/src/lib/csrf";
import { requireMerchant } from "@/src/lib/auth-helpers";
import { createActivityLog } from "@/src/lib/activity-log";
import { prisma } from "@/src/lib/db";

/**
 * [任务 19] 商家取消订单 — 仅 assigned / in_service 状态（与 customer 端 pending 不同）
 *
 * 业务规则（任务原文"商家可取消订单"）：
 * - merchant 角色
 * - 订单必须属于本商家：master.merchantId === user.merchantId
 *   （byArea 可见但未派单的订单，商家不能取消 — 那是"可派单"不是"已接单"）
 * - assigned / in_service 可取消；pending / completed / cancelled 拒绝
 * - 必填 cancelReason（与 worker 端 in_service 必填规则一致；演示期统一）
 * - 联动退款：paid → refunded（事务内一步，src/lib/orders.ts 已有）
 */
export async function merchantCancelOrderAction(
  formData: FormData,
): Promise<TransitionActionResult> {
  // 鉴权：merchant 专属
  const auth = await requireMerchant();
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
  const cancelReason = String(formData.get("cancelReason") ?? "").trim();
  if (!orderId) {
    return { ok: false, category: "validation", error: "缺少 orderId" };
  }

  // 越权防护：订单必须属于本商家（master.merchantId === auth.user.merchantId）
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      payStatus: true,
      masterId: true,
      master: { select: { merchantId: true } },
    },
  });
  if (!order) {
    return {
      ok: false,
      category: "validation",
      error: `订单 ${orderId} 不存在`,
    };
  }
  if (!order.masterId || !order.master) {
    return {
      ok: false,
      category: "validation",
      error: "该订单未派单，商家无法取消（请联系后台）",
    };
  }
  if (order.master.merchantId !== auth.user.merchantId) {
    return {
      ok: false,
      category: "validation",
      error: "该订单不属于您的商家",
    };
  }
  // 业务规则：仅 assigned / in_service 可取消
  if (order.status !== "assigned" && order.status !== "in_service") {
    return {
      ok: false,
      category: "validation",
      error: `订单状态「${order.status}」不允许商家取消`,
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

  const result = await transitionOrder(
    orderId,
    "cancelled",
    undefined,
    cancelReason,
  );
  if (result.ok) {
    // 写活动日志
    await createActivityLog({
      action: "order_canceled",
      targetType: "order",
      targetId: orderId,
      message: `商家 ${auth.user.name} 取消了订单 ${orderId}`,
      metadata: {
        cancelReason: cancelReason || undefined,
        merchantId: auth.user.merchantId,
      },
      actorId: auth.user.id,
      actorName: auth.user.name,
      actorRole: "merchant",
    });
    try {
      revalidatePath("/merchant-admin/orders");
    } catch {
      // 单测无 Next runtime
    }
  }
  return result;
}

/**
 * 商家端 helper：拿当前商家的有效 merchantId（含 admin fallback）
 * 复用于 /merchant-admin/orders/[id] 详情页
 */
export async function getCurrentMerchantId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("未登录");
  }
  return getEffectiveMerchantId(user);
}
