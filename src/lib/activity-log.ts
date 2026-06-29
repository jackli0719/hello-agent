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

export type ActivityRole = "admin" | "worker" | "customer" | "system";

export type ActivityTargetType =
  "order" | "master" | "serviceCategory" | "serviceSku" | "dispatchRule";

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
      if (session) {
        actorId = session.id;
        // 用 userId 反查 name（cookie 没存 name）
        const user = await prisma.user.findUnique({
          where: { id: session.id },
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
