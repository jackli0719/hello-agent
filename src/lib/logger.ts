// 结构化日志 — demo 期用 console，生产前替换为 Sentry / pino / logtail 等。
//
// 设计：
// - JSON 一行输出（结构化，方便后续接入 log aggregator）
// - level 分 info / error / metric 三档
// - context 字段是任意 key-value（订单 ID / 师傅 ID / 操作类型等）
//
// MVP 范围：
// - 仅 console 输出
// - dev / prod 都用 console（dev 加颜色 / pretty-print 也可，但演示版保持 JSON）
// - 关键路径调用方传 context；失败时 logError 自动加 stack

export type LogLevel = "info" | "error" | "metric";

export interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  ctx?: LogContext;
  err?: { name: string; message: string; stack?: string };
}

/** 序列化一行 JSON 写到 stdout/stderr */
function emit(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function baseEntry(level: LogLevel, msg: string, ctx?: LogContext): LogEntry {
  return {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx && Object.keys(ctx).length > 0 ? { ctx } : {}),
  };
}

/**
 * info 级别 — 记录正常业务事件（创建订单 / 状态变更 / 派单成功等）
 */
export function logInfo(msg: string, ctx?: LogContext): void {
  emit(baseEntry("info", msg, ctx));
}

/**
 * error 级别 — 记录业务错误（订单创建失败 / 状态流转失败 / 派单失败）。
 *
 * 自动捕获 error 对象 → 转成结构化字段。
 */
export function logError(msg: string, err?: unknown, ctx?: LogContext): void {
  const entry = baseEntry("error", msg, ctx);
  if (err instanceof Error) {
    entry.err = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  } else if (err !== undefined) {
    entry.err = { name: "Unknown", message: String(err) };
  }
  emit(entry);
}

/**
 * metric 级别 — 业务指标事件（订单总数 / 派单成功率 / 状态分布）。
 *
 * 调用方应同时调用 src/lib/metrics.ts 的 incrementCounter
 * 让 /admin/metrics 页面能读内存计数。
 */
export function logMetric(name: string, ctx?: LogContext): void {
  emit(baseEntry("metric", name, ctx));
}
