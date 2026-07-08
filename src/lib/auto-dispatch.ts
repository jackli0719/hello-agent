// [任务 20] 自动派单 — 区域 → 商家 → 师傅 → 技能 → 评分
//
// 设计要点（CLAUDE.md P0-0 决策）：
// - 复用 src/lib/repos/orders.ts:assignOrder(orderId)（无 masterId 版本）
//   已自带：recommendMastersForOrder + 事务 + 乐观锁
// - 这一层只做"失败原因持久化 + 触发器入口"两个事
// - 失败原因不写新表 — 复用 ActivityLog（free string，schema 不必迁）
//   失败时写 action: "auto_dispatch_failed" + metadata.failureCode/reason
// - 成功时也写 action: "auto_dispatch_succeeded"（与既有的 "order_assigned" 区分）
//   — admin 详情页能区分"自动派单成功" vs "admin 手动派单"
//
// 触发器（双入口，CLAUDE.md P0-0 决策 #1）：
// 1. payOrder 成功后 → fire-and-forget tryAutoDispatch(orderId)
// 2. admin 手动重试 → adminAutoDispatchAction(orderId) (UI 按钮)
//
// tiebreak 排序（CLAUDE.md P0-0 决策 #3）：
// rating desc → completedJobs desc → createdAt asc → id asc
// 4 层稳定排序：演示期可预测，同订单跑 2 次结果一样
//
// 不做（CLAUDE.md P3）：
// - 失败重试 1 次 / 30s 后升级 admin（v0.10+ 再做）
// - 距离计算（任务 P2-3，独立任务）
// - 派单成功写 FinanceLedger（任务 14 是按 settlement 走）

import { prisma } from "./db";
import { assignOrder, AssignOrderError } from "./repos/orders";
import { createActivityLog } from "./activity-log";
import { logInfo, logError } from "./logger";
import { incrementCounter, METRIC } from "./metrics";

/**
 * 失败原因枚举（与 dispatch.ts 的 failureCode 对齐 + auto-dispatch 自身加的）
 *
 * 来源链路：
 * 1. dispatch.ts filterMastersByArea → area_no_platform_area / area_no_merchant / area_no_master
 * 2. dispatch.ts recommendMastersForOrder → no_rule / no_skill_matched
 * 3. assignOrder 抛错 → 订单非 pending / payStatus !== paid / 候选空（已被 candidates[0] 兜住）
 *
 * auto-dispatch 自身加：
 * - order_not_pending: 订单状态不是 pending（已派单 / 已完成 / 已取消）
 * - order_not_paid: 订单未支付
 * - system_error: 派单系统错误（事务失败、并发等）
 */
export type AutoDispatchFailureCode =
  | "area_no_platform_area"
  | "area_no_merchant"
  | "area_no_master"
  | "no_rule"
  | "no_skill_matched"
  | "order_not_pending"
  | "order_not_paid"
  | "system_error";

export type AutoDispatchResult =
  | {
      ok: true;
      orderId: string;
      masterId: string;
      masterName: string;
      // 命中的规则（admin 详情页可看）
      ruleId: string | null;
      ruleName: string | null;
    }
  | {
      ok: false;
      failureCode: AutoDispatchFailureCode;
      reason: string; // 给 UI / 日志用
    };

/**
 * 自动派单主入口 — 调 assignOrder(orderId) 无 masterId 版本。
 *
 * 失败原因映射：
 * - assignOrder 抛 AssignOrderError → 错误信息含 reason，可能对应 dispatch.ts 失败或订单状态问题
 * - 解析错误信息 + 落 ActivityLog
 *
 * 关键不变量（CLAUDE.md P0-1）：
 * - 失败 → 订单保持 pending + payStatus=paid → 客户看到"待派单"
 * - 失败 → 写 ActivityLog action="auto_dispatch_failed" → admin 详情页能看
 * - 成功 → 写 ActivityLog action="auto_dispatch_succeeded" → 区分自动 vs 手动
 * - 抛错/失败不阻塞 payOrder 流程（fire-and-forget 调用方负责 try/catch）
 */
export async function tryAutoDispatch(
  orderId: string,
): Promise<AutoDispatchResult> {
  // 0. 提前 load 订单拿状态（assignOrder 内也会 load；这里多一次读为了写日志时拿 customerName）
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return {
      ok: false,
      failureCode: "order_not_pending",
      reason: `订单 ${orderId} 不存在`,
    };
  }

  try {
    const result = await assignOrder(orderId);
    // 成功
    // 注意：repos/orders.ts:assignOrder 返回 AssignOrderResult = { order, recommendation }
    // masterName/masterId 从 result.recommendation.candidates[0] 取（Order 接口没有 masterId 字段）
    const topCandidate = result.recommendation.candidates[0];
    const masterId = topCandidate?.id ?? "";
    const masterName = topCandidate?.name ?? "";
    logInfo("auto dispatch succeeded", {
      orderId,
      masterId,
      masterName,
    });
    incrementCounter(METRIC.AUTO_DISPATCH_SUCCESS, {
      orderId,
      masterId,
    });
    // 写 ActivityLog — 区分自动 vs 手动
    await createActivityLog({
      action: "auto_dispatch_succeeded",
      targetType: "order",
      targetId: orderId,
      message: `自动派单成功：师傅 ${masterName}`,
      metadata: {
        masterId,
        masterName,
      },
      actorRole: "system",
      actorName: "自动派单",
    });
    return {
      ok: true,
      orderId,
      masterId,
      masterName,
      // assignOrder 不返规则 id/name（result 接口里没）；admin 详情页查 ActivityLog 的 order_assigned 链
      ruleId: null,
      ruleName: null,
    };
  } catch (e) {
    // assignOrder 抛 AssignOrderError；message 含 reason
    const reason = e instanceof Error ? e.message : "自动派单失败";
    const failureCode = mapAssignErrorToFailureCode(e);
    logInfo("auto dispatch failed", { orderId, failureCode, reason });
    incrementCounter(METRIC.AUTO_DISPATCH_FAILED, { failureCode });
    // 写 ActivityLog — failureCode 存 metadata 给 UI 读取
    await createActivityLog({
      action: "auto_dispatch_failed",
      targetType: "order",
      targetId: orderId,
      message: `自动派单失败 [${failureCode}]: ${reason}`,
      metadata: { failureCode, reason, customerName: order.customerName },
      actorRole: "system",
      actorName: "自动派单",
    });
    return { ok: false, failureCode, reason };
  }
}

/**
 * 把 assignOrder 抛出的错误映射到 AutoDispatchFailureCode。
 *
 * 映射规则（按优先级）：
 * 1. e.failureCode 是 dispatch.ts 透传的精确 code（任务 20 新增 AssignOrderError 字段）
 *    → 优先用：area_no_platform_area / area_no_merchant / area_no_master / no_rule / no_skill_matched
 * 2. fallback 看错误信息关键词
 * 3. 兜底：system_error
 *
 * 业务原则（CLAUDE.md P0-4 简化即 bug）：
 * 宁可分类粗一点（system_error）也别误分类 — 演示期可调试比精准重要
 */
function mapAssignErrorToFailureCode(e: unknown): AutoDispatchFailureCode {
  // 1. 优先用 AssignOrderError.failureCode（repos/orders.ts:assignOrder 透传 dispatch.ts 的 failureCode）
  if (e instanceof AssignOrderError && e.failureCode) {
    // 透传：area_no_platform_area / area_no_merchant / area_no_master / no_rule / no_skill_matched
    if (
      e.failureCode === "area_no_platform_area" ||
      e.failureCode === "area_no_merchant" ||
      e.failureCode === "area_no_master" ||
      e.failureCode === "no_rule" ||
      e.failureCode === "no_skill_matched"
    ) {
      return e.failureCode;
    }
  }

  // 2. fallback 看 message 关键词
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof AssignOrderError) {
    if (message.includes("未支付") || message.includes("payStatus")) {
      return "order_not_paid";
    }
    if (
      message.includes("不可重复派单") ||
      message.includes("状态") ||
      message.includes("pending")
    ) {
      return "order_not_pending";
    }
  }
  return "system_error";
}

// ============================================================
// 失败原因查询（admin / customer / merchant 详情页用）
// ============================================================

/**
 * 取订单最近一次自动派单失败原因。
 *
 * 规则：按 createdAt desc 取最近 1 条 action="auto_dispatch_failed" 的 ActivityLog
 * 不限时间（演示期不强求"近 7 天"）— 失败原因长期可查
 *
 * @returns 失败时返回 { failureCode, reason, createdAt }；无失败日志返 null
 */
export async function getLatestDispatchFailure(orderId: string): Promise<{
  failureCode: AutoDispatchFailureCode;
  reason: string;
  createdAt: Date;
} | null> {
  const log = await prisma.activityLog.findFirst({
    where: {
      targetType: "order",
      targetId: orderId,
      action: "auto_dispatch_failed",
    },
    orderBy: { createdAt: "desc" },
    select: {
      metadata: true,
      message: true,
      createdAt: true,
    },
  });
  if (!log) return null;
  // metadata 是 JSON 字符串 — 解析拿 failureCode
  let failureCode: AutoDispatchFailureCode = "system_error";
  let reason = log.message;
  try {
    const meta = JSON.parse(log.metadata) as {
      failureCode?: string;
      reason?: string;
    };
    if (meta.failureCode) {
      failureCode = meta.failureCode as AutoDispatchFailureCode;
    }
    if (meta.reason) {
      reason = meta.reason;
    }
  } catch {
    // metadata 不是合法 JSON — 用 message 当 reason
  }
  return { failureCode, reason, createdAt: log.createdAt };
}

// ============================================================
// 失败原因 UI 展示文案（3 端共用）
// ============================================================

/**
 * 把 failureCode 翻译成用户可读的中文原因。
 *
 * 设计原则（CLAUDE.md P0-4）：
 * - 不掩盖事实（直接告诉用户/运营原因）
 * - 留联系 admin 的提示（"请等待调度" / "联系客服"）
 */
export function describeFailureCode(code: AutoDispatchFailureCode): string {
  switch (code) {
    case "area_no_platform_area":
      return "当前区域暂未开通服务";
    case "area_no_merchant":
      return "当前区域暂无商家覆盖";
    case "area_no_master":
      return "当前区域商家暂无师傅";
    case "no_rule":
      return "暂无匹配的派单规则";
    case "no_skill_matched":
      return "暂无可服务该订单的师傅";
    case "order_not_pending":
      return "订单状态不符合自动派单条件";
    case "order_not_paid":
      return "订单未支付";
    case "system_error":
      return "派单系统异常，请稍后重试";
    default:
      return "派单失败";
  }
}
