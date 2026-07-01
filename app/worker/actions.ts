"use server";

// 师傅端 server actions — 状态流转动作。
//
// 设计：直接复用 app/orders/actions.ts 已有的 startServiceAction / completeOrderAction，
// 业务逻辑（乐观锁、释放师傅）在 src/lib/orders.ts 的 transitionOrder 里集中实现。
// 这里只是「师傅端也能调这些 action」的转发层。
//
// 为什么不做薄一层 wrapper：
// - 业务逻辑零差异（同样是 assigned→in_service、in_service→completed）
// - 想复制业务逻辑就是制造分叉（违反 P0-4「业务逻辑简化即 bug」）
// - 真要给师傅端加额外校验（比如校验「调用者必须是该订单的 masterId」），也在这里加
//   — 当前阶段按需求 #1 不做师傅登录，所以这一层暂时只 revalidate /worker

import { revalidatePath } from "next/cache";
import { prisma } from "@/src/lib/db";
import { createActivityLog } from "@/src/lib/activity-log";
import { transitionOrder, type TransitionOrderResult } from "@/src/lib/orders";
import { requireWorker } from "@/src/lib/auth-helpers";

/** 师傅端 server action 返回值 */
export type WorkerActionResult =
  | { ok: true; orderId: string; nextStatus: string }
  | {
      ok: false;
      category: "validation" | "system";
      error: string;
    };

/**
 * 师傅端「开始服务」— assigned → in_service。
 * [v0.9.6] 师傅版独立 action：
 * - requireWorker 校验角色 + workerId
 * - masterId 归属校验（防师傅越权操作别人的订单）
 * - 直接调 transitionOrder（不走 admin action，避开 requireAdmin）
 */
export async function workerStartServiceAction(
  orderId: string,
): Promise<WorkerActionResult> {
  // [v0.9.6] P0 鉴权：worker 角色 + workerId
  const auth = await requireWorker();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }

  // [v0.9.6] 越权防护：订单的 masterId 必须等于当前 worker
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { masterId: true },
  });
  if (!order) {
    return { ok: false, category: "validation", error: "订单不存在" };
  }
  if (order.masterId !== auth.user.workerId) {
    return {
      ok: false,
      category: "validation",
      error: "该订单不属于您",
    };
  }

  // 调底层 transitionOrder（不走 admin action）
  const result = await transitionOrder(orderId, "in_service");

  if (result.ok) {
    // 写操作日志
    await createActivityLog({
      action: "service_started",
      targetType: "order",
      targetId: result.orderId,
      message: `师傅 ${result.masterName ?? ""} 开始服务订单 ${result.orderId}`,
      metadata: {
        fromStatus: result.fromStatus,
        toStatus: "in_service",
        masterName: result.masterName,
      },
    });
  }

  try {
    revalidatePath("/worker");
  } catch {
    // 单测无 Next runtime
  }

  if (result.ok) {
    return { ok: true, orderId: result.orderId, nextStatus: result.nextStatus };
  }
  if (result.category === "validation") {
    return { ok: false, category: "validation", error: result.error };
  }
  return { ok: false, category: "system", error: result.error };
}

/**
 * 师傅端「完成订单」— in_service → completed。
 * [v0.9.6] 同上：独立鉴权 + 越权防护
 * [v0.7.6] 可选 serviceSummary：师傅填的服务完成说明
 */
export async function workerCompleteOrderAction(
  orderId: string,
  serviceSummary?: string,
): Promise<WorkerActionResult> {
  // [v0.9.6] P0 鉴权：worker 角色 + workerId
  const auth = await requireWorker();
  if (!auth.ok) {
    return { ok: false, category: auth.category, error: auth.error };
  }

  // [v0.9.6] 越权防护
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { masterId: true },
  });
  if (!order) {
    return { ok: false, category: "validation", error: "订单不存在" };
  }
  if (order.masterId !== auth.user.workerId) {
    return {
      ok: false,
      category: "validation",
      error: "该订单不属于您",
    };
  }

  const result = await transitionOrder(orderId, "completed", serviceSummary);

  if (result.ok) {
    await createActivityLog({
      action: "order_completed",
      targetType: "order",
      targetId: result.orderId,
      message: `师傅 ${result.masterName ?? ""} 完成订单 ${result.orderId}`,
      metadata: {
        fromStatus: result.fromStatus,
        toStatus: "completed",
        masterName: result.masterName,
        serviceSummary,
      },
    });
  }

  try {
    revalidatePath("/worker");
  } catch {
    // 单测无 Next runtime
  }

  if (result.ok) {
    return { ok: true, orderId: result.orderId, nextStatus: result.nextStatus };
  }
  if (result.category === "validation") {
    return { ok: false, category: "validation", error: result.error };
  }
  return { ok: false, category: "system", error: result.error };
}

// 抑制 unused import 警告
void transitionOrder as unknown as TransitionOrderResult;
