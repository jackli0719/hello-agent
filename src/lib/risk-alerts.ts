// [任务 23] 风控预警（risk-alerts）— MVP 实时聚合
//
// 范围（任务 23 决策）：
// - 仅 2 类：派单失败 + 异常提现
// - 实时查询：不存 RiskAlert 表，每次打开页面现聚合 Order / WithdrawRequest / ActivityLog
// - 阈值写死默认（不在 config 文件暴露，后续运营可调）
//
// 异常提现 3 条规则（来自 P0-0 风险清单 R1）：
// R1.1 单笔 amount ≥ ¥5000（即 500_000 分）
// R1.2 同一 merchantId 7 天内 ≥ 3 笔 pending 申请
// R1.3 单笔 amount > 该 merchant 当前 confirmed 余额的 80%
//      （防超提 — 演示期简化：只查 confirmed，不扣减 pending/approved/paid）
//
// 派单失败 1 条规则：
// R2.1 最近 24h 内所有 ActivityLog.action = 'auto_dispatch_failed'
//
// 设计（CLAUDE.md P0-4）：
// - "只预警不拦截"：本模块纯查询，零写副作用，不动 Order / WithdrawRequest
// - "MVP 边界"：演示期不接入阈值配置文件；后续若需调阈值，改 RISK_THRESHOLDS 即可

import { prisma } from "@/src/lib/db";
import { AutoDispatchFailureCode } from "@/src/lib/auto-dispatch";

// ============================================================
// 阈值常量（任务 23 决策：写死默认）
// ============================================================

/** 单笔提现金额告警阈值（分）= ¥5000 */
export const LARGE_WITHDRAW_AMOUNT_CENTS = 500_000;

/** 同一商家 7 天内 pending 申请数阈值 */
export const FREQUENT_PENDING_WITHDRAW_COUNT = 3;

/** 单笔申请金额占该商家已确认余额上限比例（0-1） */
export const OVERDRAW_RATIO = 0.8;

/** 派单失败查询时间窗（毫秒）= 24 小时 */
export const DISPATCH_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ============================================================
// 类型导出
// ============================================================

/** 异常提现预警单条 */
export interface WithdrawAnomalyAlert {
  kind: "large_amount" | "frequent_pending" | "overdraw";
  /** 提现申请 id（large_amount / overdraw 才有；frequent_pending 是聚合条目） */
  withdrawRequestId?: string;
  merchantId: string;
  merchantName: string;
  /** 触发金额（分）；frequent_pending 不带金额 */
  amountCents?: number;
  /** 余额信息（overdraw 用） */
  confirmedIncomeCents?: number;
  thresholdCents?: number;
  /** frequent_pending 用：7 天内 pending 笔数 */
  pendingCount?: number;
  /** 触发时间 */
  createdAt: Date;
}

/** 派单失败预警单条 */
export interface DispatchFailureAlert {
  /** ActivityLog id */
  activityLogId: string;
  orderId: string;
  customerName: string;
  failureCode: AutoDispatchFailureCode;
  reason: string;
  createdAt: Date;
}

/** 聚合返回 */
export interface RiskAlertsSummary {
  dispatchFailures: DispatchFailureAlert[];
  withdrawAnomalies: WithdrawAnomalyAlert[];
  /** 取数时间戳（前端展示用） */
  generatedAt: Date;
}

// ============================================================
// 派单失败 — 最近 24h
// ============================================================

/**
 * 查询最近 24h 内的所有派单失败日志。
 * - 数据源：ActivityLog.action = 'auto_dispatch_failed'
 * - 不限 order.status（演示期不区分"还没派"还是"派了失败"）
 * - 按 createdAt desc 排序
 */
export async function getDispatchFailureAlerts(
  now: Date = new Date(),
): Promise<DispatchFailureAlert[]> {
  const cutoff = new Date(now.getTime() - DISPATCH_FAILURE_WINDOW_MS);
  const logs = await prisma.activityLog.findMany({
    where: {
      action: "auto_dispatch_failed",
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      targetId: true,
      message: true,
      metadata: true,
      createdAt: true,
    },
  });

  return logs.map((log) => {
    // 解析 metadata 拿 failureCode / customerName；metadata 不是合法 JSON 时兜底
    let failureCode: AutoDispatchFailureCode = "system_error";
    let customerName = "未知客户";
    try {
      const meta = JSON.parse(log.metadata) as {
        failureCode?: string;
        customerName?: string;
      };
      if (meta.failureCode) {
        failureCode = meta.failureCode as AutoDispatchFailureCode;
      }
      if (meta.customerName) {
        customerName = meta.customerName;
      }
    } catch {
      // metadata 不是 JSON — 用 message 当 reason
    }
    // reason 从 message 提取：[code]: reason
    const match = log.message.match(/\[([^\]]+)\]:\s*(.*)/);
    const reason = match?.[2] ?? log.message;
    return {
      activityLogId: log.id,
      orderId: log.targetId,
      customerName,
      failureCode,
      reason,
      createdAt: log.createdAt,
    };
  });
}

// ============================================================
// 异常提现 — 3 条规则
// ============================================================

/**
 * 单笔金额 ≥ LARGE_WITHDRAW_AMOUNT_CENTS — 查所有 pending 申请。
 * # MVP: 含 approved（金额大的即使过了审核也复盘）；rejected 不查
 */
async function getLargeAmountAlerts(): Promise<WithdrawAnomalyAlert[]> {
  const rows = await prisma.withdrawRequest.findMany({
    where: {
      amount: { gte: LARGE_WITHDRAW_AMOUNT_CENTS },
      status: { in: ["pending", "approved"] },
    },
    orderBy: { createdAt: "desc" },
    include: {
      merchant: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    kind: "large_amount" as const,
    withdrawRequestId: r.id,
    merchantId: r.merchantId,
    merchantName: r.merchant.name,
    amountCents: r.amount,
    thresholdCents: LARGE_WITHDRAW_AMOUNT_CENTS,
    createdAt: r.createdAt,
  }));
}

/**
 * 同一 merchant 7 天内 pending ≥ FREQUENT_PENDING_WITHDRAW_COUNT。
 * - 用 groupBy 按 merchantId 聚合；只返命中阈值的组
 */
async function getFrequentPendingAlerts(
  now: Date = new Date(),
): Promise<WithdrawAnomalyAlert[]> {
  const cutoff = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000, // 7 天
  );
  const grouped = await prisma.withdrawRequest.groupBy({
    by: ["merchantId"],
    where: {
      status: "pending",
      createdAt: { gte: cutoff },
    },
    _count: { merchantId: true },
    _max: { createdAt: true },
    having: {
      merchantId: { _count: { gte: FREQUENT_PENDING_WITHDRAW_COUNT } },
    },
  });
  if (grouped.length === 0) return [];

  const merchants = await prisma.merchant.findMany({
    where: { id: { in: grouped.map((g) => g.merchantId) } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(merchants.map((m) => [m.id, m.name]));

  return grouped.map((g) => ({
    kind: "frequent_pending" as const,
    merchantId: g.merchantId,
    merchantName: nameMap.get(g.merchantId) ?? g.merchantId,
    pendingCount: g._count.merchantId,
    createdAt: g._max.createdAt ?? new Date(),
  }));
}

/**
 * 单笔 > merchant 当前 confirmed 余额 × OVERDRAW_RATIO — 防超提。
 * - "当前 confirmed 余额"：Σ MerchantSettlement.merchantIncome WHERE status=confirmed
 *   # MVP: 演示期简化，不扣减已 payout/pending/approved 金额（用总额上限兜底）
 * - 应用层筛选（threshold = confirmedIncome * 0.8）
 */
async function getOverdrawAlerts(): Promise<WithdrawAnomalyAlert[]> {
  // Step 1: 拿所有 pending/approved 申请 + 该 merchant confirmed 余额
  const requests = await prisma.withdrawRequest.findMany({
    where: {
      status: { in: ["pending", "approved"] },
    },
    orderBy: { createdAt: "desc" },
    include: {
      merchant: { select: { id: true, name: true } },
    },
  });
  if (requests.length === 0) return [];

  // Step 2: 聚合每个 merchant 的 confirmed 余额
  const merchantIds = [...new Set(requests.map((r) => r.merchantId))];
  const incomes = await prisma.merchantSettlement.groupBy({
    by: ["merchantId"],
    where: {
      merchantId: { in: merchantIds },
      status: "confirmed",
    },
    _sum: { merchantIncome: true },
  });
  const incomeMap = new Map(
    incomes.map((i) => [i.merchantId, i._sum.merchantIncome ?? 0]),
  );

  // Step 3: 单笔金额 > 余额 × 0.8 → 告警
  const alerts: WithdrawAnomalyAlert[] = [];
  for (const r of requests) {
    const income = incomeMap.get(r.merchantId) ?? 0;
    const threshold = Math.floor(income * OVERDRAW_RATIO);
    if (r.amount > threshold) {
      alerts.push({
        kind: "overdraw" as const,
        withdrawRequestId: r.id,
        merchantId: r.merchantId,
        merchantName: r.merchant.name,
        amountCents: r.amount,
        confirmedIncomeCents: income,
        thresholdCents: threshold,
        createdAt: r.createdAt,
      });
    }
  }
  return alerts;
}

/** 合并 3 条规则的告警列表 */
export async function getWithdrawAnomalyAlerts(
  now: Date = new Date(),
): Promise<WithdrawAnomalyAlert[]> {
  const [large, frequent, overdraw] = await Promise.all([
    getLargeAmountAlerts(),
    getFrequentPendingAlerts(now),
    getOverdrawAlerts(),
  ]);
  // frequent_pending 用 _max.createdAt 排序；其他用 createdAt desc
  // 合并后整体按 createdAt desc
  return [...large, ...frequent, ...overdraw].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

// ============================================================
// 聚合入口（页面调用）
// ============================================================

/** 一次拿全 2 类预警 */
export async function getRiskAlertsSummary(
  now: Date = new Date(),
): Promise<RiskAlertsSummary> {
  const [dispatchFailures, withdrawAnomalies] = await Promise.all([
    getDispatchFailureAlerts(now),
    getWithdrawAnomalyAlerts(now),
  ]);
  return { dispatchFailures, withdrawAnomalies, generatedAt: now };
}
