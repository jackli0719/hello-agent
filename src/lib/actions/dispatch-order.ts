"use server";

import { revalidatePath } from "next/cache";
import { assignOrder, AssignOrderError } from "@/src/lib/repos/orders";

// 失败原因分两类：
// - "validation"：调用方应该内联展示在按钮旁边（订单不存在、状态错等）
// - "system"：调用方应该展示一个 banner 让用户重试
export type DispatchActionResult =
  | { ok: true; orderId: string; technicianName: string; reason: string }
  | { ok: false; category: "validation" | "system"; error: string };

/**
 * 给指定订单派单。
 * - 找到最佳师傅 → 改订单 + 师傅状态（事务） → revalidate
 * - 任何一步失败 → 返回结构化错误，UI 处理
 */
export async function dispatchOrderAction(
  orderId: string,
): Promise<DispatchActionResult> {
  try {
    const { order, recommendation } = await assignOrder(orderId);
    const top = recommendation.candidates[0];
    if (!top) {
      return {
        ok: false,
        category: "validation",
        error: recommendation.reason,
      };
    }

    try {
      revalidatePath("/orders");
      revalidatePath("/");
    } catch {
      // 单测无 Next runtime，吞掉
    }

    return {
      ok: true,
      orderId: order.id,
      technicianName: top.name,
      reason: recommendation.reason,
    };
  } catch (e) {
    if (e instanceof AssignOrderError) {
      // 「没找到师傅」这类是预期内的业务失败，归 validation（让用户看原因）
      return { ok: false, category: "validation", error: e.reason };
    }
    return { ok: false, category: "system", error: "派单失败，请稍后再试" };
  }
}
