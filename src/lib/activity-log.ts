// 操作日志工具 — [v0.4.0] 2026-06-29 引入。
//
// 设计：
// - createActivityLog()：fire-and-forget，失败不抛错，不影响主业务
// - 取 actor 用 getActorFromSession()：从 cookie 读 userId → 查 User 表
// - 系统行为（seed / 定时任务）可传 actorRole='system'
//
// # MVP: 仅记录核心动作；不做复杂审计、不做搜索、不做导出、不做删除

import { prisma } from "./db";
import { getSession } from "./auth";

// [任务 19] merchant 角色加入 — 商家端取消订单时埋点
export type ActivityRole = "admin" | "worker" | "customer" | "merchant" | "system";

export type ActivityTargetType =
  | "order"
  | "master"
  | "serviceCategory"
  | "serviceSku"
  | "dispatchRule"
  | "platformArea"
  | "merchant"
  | "merchantArea"
  | "commissionStrategy" // [任务 5] 分成策略
  | "settlementPreview" // [任务 6] 结算预览
  | "merchantSettlement" // [任务 7] 商家结算汇总
  | "payoutRecord" // [任务 12] 线下打款记录
  | "withdrawRequest" // [任务 13] 提现申请
  | "workerWithdrawRequest"; // [任务 T2-1] 师傅提现申请

export interface CreateActivityLogInput {
  action: string;
  targetType: ActivityTargetType;
  targetId: string;
  message: string;
  metadata?: Record<string, unknown>;
  // 可选覆盖（默认从 session 取）
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: ActivityRole | null;
}

/**
 * 写一条操作日志。
 *
 * 关键不变量（CLAUDE.md P0-1）：
 * - 失败必须 try/catch 吞掉，**不能**影响主业务流程
 * - metadata 可空，默认 "{}"
 * - actor 信息可显式传（system 行为），否则从 session 取
 */
export async function createActivityLog(
  input: CreateActivityLogInput,
): Promise<void> {
  try {
    // 1. 解析 actor
    let actorId = input.actorId ?? null;
    let actorName = input.actorName ?? null;
    let actorRole: ActivityRole = (input.actorRole as ActivityRole) ?? "system";

    if (input.actorId === undefined && input.actorName === undefined) {
      // 默认从 session 取
      const session = await getSession();
      if (session.userId) {
        actorId = session.userId;
        // 用 userId 反查 name（cookie 没存 name）
        const user = await prisma.user.findUnique({
          where: { id: session.userId },
          select: { name: true, role: true },
        });
        if (user) {
          actorName = user.name;
          actorRole = user.role as ActivityRole;
        }
      }
    }

    // 2. 落库
    await prisma.activityLog.create({
      data: {
        actorId,
        actorName: actorName ?? actorRole,
        actorRole,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        message: input.message,
        metadata: JSON.stringify(input.metadata ?? {}),
      },
    });
  } catch (e) {
    // 关键：日志失败不影响主业务 — 仅 console.warn
    console.warn(
      `[activity-log] 写日志失败（已吞掉）: ${(e as Error).message}`,
    );
  }
}

/**
 * 读最近 N 条日志（按 createdAt desc）。
 * 给 Dashboard 用。
 */
export async function listRecentActivityLogs(limit = 20) {
  return prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// ============================================================
// [v0.8.0] /activity-logs 页面 — 筛选 + 分页
// ============================================================

/**
 * action 白名单 — 业务规则列的 11 条 + cancel 变体（与 orders/actions.ts 一致）
 * 硬编码而非 distinct DB 查询：保证下拉顺序与业务规则一一对应，避免隐藏字段
 */
export const ACTIVITY_ACTIONS = [
  "order_created",
  "order_assigned",
  "service_started",
  "order_completed",
  "order_canceled",
  "order_dispatch_canceled",
  "order_internal_remark_updated",
  "order_service_summary_added",
  "master_created",
  "master_updated",
  "service_sku_created",
  "service_sku_updated",
  "dispatch_rule_created",
  "dispatch_rule_updated",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** role 白名单 */
export const ACTIVITY_ROLES = [
  "admin",
  "worker",
  "customer",
  "system",
] as const;
export type ActivityRoleFilter = (typeof ACTIVITY_ROLES)[number];

/**
 * targetType 白名单 — UI 列举用
 * （schema 里有 serviceCategory，但日志暂不写它；留 4 个业务常用）
 */
export const ACTIVITY_TARGET_TYPES = [
  "order",
  "master",
  "serviceSku",
  "dispatchRule",
] as const;
export type ActivityTargetTypeFilter = (typeof ACTIVITY_TARGET_TYPES)[number];

export interface ActivityLogFilter {
  actorRole?: ActivityRoleFilter;
  action?: ActivityAction;
  targetType?: ActivityTargetTypeFilter;
  keyword?: string;
}

export interface ListActivityLogsResult {
  logs: Awaited<ReturnType<typeof prisma.activityLog.findMany>>;
  totalCount: number;
}

/**
 * 抽 where 构造 — 列表 + totalCount 共用，避免漂移（CLAUDE.md P0-3）
 * 注意：keyword 用 contains + mode:'insensitive' 让「客户」能搜到「客户」
 */
function buildActivityLogWhere(filter: ActivityLogFilter) {
  const where: Record<string, unknown> = {};
  if (filter.actorRole) where.actorRole = filter.actorRole;
  if (filter.action) where.action = filter.action;
  if (filter.targetType) where.targetType = filter.targetType;
  if (filter.keyword && filter.keyword.trim()) {
    // SQLite 大小写不敏感 — 业务希望「客户」/「客户」互搜得到
    where.message = {
      contains: filter.keyword.trim(),
      mode: "insensitive",
    };
  }
  return where;
}

/**
 * 读筛选 + 分页后的日志（按 createdAt desc，加 id tiebreaker 防同秒数据漂移）
 */
export async function listActivityLogs(
  filter: ActivityLogFilter,
  page: number,
  pageSize: number,
): Promise<ListActivityLogsResult> {
  const where = buildActivityLogWhere(filter);
  const skip = (page - 1) * pageSize;
  const [logs, totalCount] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.activityLog.count({ where }),
  ]);
  return { logs, totalCount };
}
