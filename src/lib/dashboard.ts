// [任务 22] 数据看板 — 全局 6 指标聚合查询
//
// 设计：
// - 演示期数据量小（20 订单），Prisma groupBy/aggregate 一次拿全部
// - 6 指标 = GMV + 订单量 + 完单率 + 退款率 + 商家收入 + 平台抽成
// - 2 时间窗口："all"（全集）/ "thisMonth"（本月）
// - 所有金额单位：分 → 元（/100 在转换层）
// - 完单率分母：completed + cancelled（终态订单）；退款率分母：所有 paid 订单
//
// 不做（CLAUDE.md P0-4 简化即 bug 边界）：
// - 不画趋势图（groupBy by day = 后续 P2-5）
// - 不分商家（admin 全局视角）
// - 不缓存（演示期一次 DB 查询 < 5ms）
// - 不实时刻画（演示期手动 reload 即可）

import { prisma } from "./db";

export interface DashboardMetrics {
  gmvYuan: number; // GMV（已支付且已完成订单金额之和 / 元）
  orderCount: number; // 订单总数
  completionRate: number; // 完单率 = completed / (completed + cancelled)
  refundRate: number; // 退款率 = refunded / (paid + refunded)
  merchantIncomeYuan: number; // 商家收入（SettlementPreview.merchantAmount 之和 / 元）
  platformFeeYuan: number; // 平台抽成（SettlementPreview.platformAmount 之和 / 元）
}

export type DashboardWindow = "all" | "thisMonth";

/**
 * 取当月起点（[任务 14] 财务流水模式：演示期 now 总是落在 2026-06）
 * 缓存为一次 now 避免并行聚合窗口漂移
 */
function getMonthStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * 取看板 6 指标
 *
 * 口径：
 * - GMV = status=completed AND payStatus=paid 的 Order.amount 之和
 * - 订单量 = Order 总数
 * - 完单率 = completed / (completed + cancelled)
 * - 退款率 = refunded / (paid + refunded)（订单进入支付才可能被退款）
 * - 商家收入 = SettlementPreview.merchantAmount 之和（已完成订单的分成快照）
 * - 平台抽成 = SettlementPreview.platformAmount 之和
 */
export async function getDashboardMetrics(
  window: DashboardWindow,
): Promise<DashboardMetrics> {
  // 月初窗口（演示期 = 2026-06-01；非本月 = 退化全集）
  // 缓存一次 now 避免并行聚合窗口漂移（CLAUDE.md 风险 9）
  const now = new Date();
  const monthStart = getMonthStart(now);
  const timeFilter = window === "thisMonth" ? { gte: monthStart } : undefined;

  // 7 个聚合并行（Prisma + PG 透明）
  const [
    gmvAgg,
    orderCount,
    completedCount,
    cancelledCount,
    refundedCount,
    paidCount,
    settlementAgg,
  ] = await Promise.all([
    // GMV = paid 且 completed 订单金额
    prisma.order.aggregate({
      where: { status: "completed", payStatus: "paid", paidAt: timeFilter },
      _sum: { amount: true },
    }),
    // 订单总数
    prisma.order.count({ where: { createdAt: timeFilter } }),
    // 完单分子
    prisma.order.count({
      where: { status: "completed", createdAt: timeFilter },
    }),
    // 完单分母 = cancelled
    prisma.order.count({
      where: { status: "cancelled", createdAt: timeFilter },
    }),
    // 退款分子
    prisma.order.count({
      where: { payStatus: "refunded", createdAt: timeFilter },
    }),
    // 退款率分母 = paid 订单数
    prisma.order.count({
      where: { payStatus: "paid", createdAt: timeFilter },
    }),
    // 商家收入 + 平台抽成（已完成的 SettlementPreview）
    prisma.settlementPreview.aggregate({
      where: { createdAt: timeFilter },
      _sum: { merchantAmount: true, platformAmount: true },
    }),
  ]);

  const gmvYuan = (gmvAgg._sum.amount ?? 0) / 100;
  const completionRate =
    completedCount + cancelledCount > 0
      ? completedCount / (completedCount + cancelledCount)
      : 0;
  const refundRate =
    paidCount + refundedCount > 0
      ? refundedCount / (paidCount + refundedCount)
      : 0;
  const merchantIncomeYuan = (settlementAgg._sum.merchantAmount ?? 0) / 100;
  const platformFeeYuan = (settlementAgg._sum.platformAmount ?? 0) / 100;

  return {
    gmvYuan,
    orderCount,
    completionRate,
    refundRate,
    merchantIncomeYuan,
    platformFeeYuan,
  };
}
