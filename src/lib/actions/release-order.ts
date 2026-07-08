"use server";

import { revalidatePath } from "next/cache";
import { releaseMaster, ReleaseOrderError } from "@/src/lib/repos/orders";

export type ReleaseActionResult =
  | { ok: true; orderId: string; status: "completed" | "cancelled" }
  | { ok: false; category: "validation" | "system"; error: string };

/**
 * 释放订单 — 把订单改 completed/cancelled，同时把对应师傅从 busy 改回 available。
 *
 * 当前阶段没有 UI 调用这个 action（专门写了单测覆盖），下一阶段做状态流转时会
 * 在订单详情页加「完成」「取消」按钮。
 */
export async function releaseOrderAction(
  orderId: string,
  nextStatus: "completed" | "cancelled",
): Promise<ReleaseActionResult> {
  try {
    const order = await releaseMaster(orderId, nextStatus);

    try {
      revalidatePath("/orders");
      revalidatePath("/");
    } catch {
      // 单测无 Next runtime，吞掉
    }

    return { ok: true, orderId: order.id, status: nextStatus };
  } catch (e) {
    if (e instanceof ReleaseOrderError) {
      return { ok: false, category: "validation", error: e.reason };
    }
    return { ok: false, category: "system", error: "释放失败，请稍后再试" };
  }
}
