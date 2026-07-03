// 业务指标 — 内存计数器（演示版）。
//
// 设计：
// - 进程内 Map 计数（dev 模式每次 HMR 重启会清零；prod 进程生命周期内有效）
// - counter name 用 dot-separated（如 "order.create.success"）
// - 单次数据快照：snapshot() 返对象方便页面渲染
//
// MVP 范围：
// - 只计数，不算率（成功率 = success / (success + failed)）
// - 不持久化（重启清零是预期）
// - 不发外部（演示版不接 Prometheus / Datadog）
//
// 生产前必修：
// - 换 Prometheus client + push gateway
// - 或 OpenTelemetry → 任意 backend
// - 关键事件发 Sentry / LogRocket

import { logMetric } from "./logger";

interface MetricsSnapshot {
  counters: Record<string, number>;
  /** uptime in seconds since process start */
  uptimeSec: number;
  /** ISO timestamp when snapshot was taken */
  ts: string;
}

// 进程级全局状态（dev HMR 防重置：挂 globalThis）
const globalForMetrics = globalThis as unknown as {
  __o2o_metrics: Map<string, number> | undefined;
  __o2o_metrics_start: number | undefined;
};

const counters: Map<string, number> =
  globalForMetrics.__o2o_metrics ?? new Map<string, number>();
const startedAt: number = globalForMetrics.__o2o_metrics_start ?? Date.now();

if (process.env.NODE_ENV !== "production") {
  globalForMetrics.__o2o_metrics = counters;
  globalForMetrics.__o2o_metrics_start = startedAt;
}

/**
 * 计数 +1。
 * 自动调 logMetric 输出 JSON 日志，方便 dev 看 + 未来接 log aggregator。
 */
export function incrementCounter(
  name: string,
  ctx?: Record<string, unknown>,
): void {
  counters.set(name, (counters.get(name) ?? 0) + 1);
  logMetric(name, ctx);
}

/**
 * 取当前快照（页面渲染用）。
 */
export function getMetricsSnapshot(): MetricsSnapshot {
  const obj: Record<string, number> = {};
  for (const [k, v] of counters.entries()) {
    obj[k] = v;
  }
  return {
    counters: obj,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    ts: new Date().toISOString(),
  };
}

/**
 * 重置所有计数器 — 主要给测试用。
 */
export function resetCounters(): void {
  counters.clear();
}

/**
 * 预设的 counter name（避免散落字符串 typo）：
 * - order.create.success / order.create.failed
 * - order.assign.success / order.assign.failed
 * - order.transition.success / order.transition.failed
 *   （细维度按 nextStatus 分：transition.success.in_service 等）
 */
export const METRIC = {
  ORDER_CREATE_SUCCESS: "order.create.success",
  ORDER_CREATE_FAILED: "order.create.failed",
  // [支付] 模拟支付成功/失败 — 任务 X 演示闭环
  ORDER_PAY_SUCCESS: "order.pay.success",
  ORDER_PAY_FAILED: "order.pay.failed",
  ORDER_ASSIGN_SUCCESS: "order.assign.success",
  ORDER_ASSIGN_FAILED: "order.assign.failed",
  ORDER_TRANSITION_SUCCESS: (status: string) =>
    `order.transition.success.${status}`,
  ORDER_TRANSITION_FAILED: (status: string) =>
    `order.transition.failed.${status}`,
  // [任务 19] 售后退款（completed 订单专属）
  ORDER_REFUND_SUCCESS: "order.refund.success",
  ORDER_REFUND_FAILED: "order.refund.failed",
} as const;
