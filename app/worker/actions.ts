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
import {
  startServiceAction,
  completeOrderAction,
  type TransitionActionResult,
} from "@/app/orders/actions";

/**
 * 师傅端「开始服务」— assigned → in_service。
 * 包装后台的 startServiceAction，额外 revalidate /worker。
 */
export async function workerStartServiceAction(
  orderId: string,
): Promise<TransitionActionResult> {
  const result = await startServiceAction(orderId);
  try {
    revalidatePath("/worker");
  } catch {
    // 单测无 Next runtime
  }
  return result;
}

/**
 * 师傅端「完成订单」— in_service → completed。
 * 包装后台的 completeOrderAction，额外 revalidate /worker。
 * [v0.7.6] 可选 serviceSummary：师傅填的服务完成说明。
 */
export async function workerCompleteOrderAction(
  orderId: string,
  serviceSummary?: string,
): Promise<TransitionActionResult> {
  const result = await completeOrderAction(orderId, serviceSummary);
  try {
    revalidatePath("/worker");
  } catch {
    // 单测无 Next runtime
  }
  return result;
}
