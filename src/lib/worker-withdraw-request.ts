// [任务 T2-1] 师傅提现申请（WorkerWithdrawRequest）业务逻辑
//
// 设计要点（与 WithdrawRequest 镜像）：
// - workerId: FK Master (Cascade)
// - amount: 单位 分；师傅自填
// - status: pending / approved / rejected
//   - pending → approved / rejected (单向)
//   - approved → 不联动 PayoutRecord（师傅端无 payout 流程）
// - remark: 师傅填的用途（optional）
// - rejectReason: admin 必填拒绝原因（status=rejected 时必填）
// - 可提现余额 = Σ(WorkerSettlement.workerIncome)
//                − Σ(WorkerWithdrawRequest.amount | status ∈ pending, approved)
// - 同一 worker 不能同时有 2 条 pending 申请
//
// 金额单位：分（与 WorkerSettlement 一致）
//
// [P0 必修 2026-07-03] 并发 + 状态机硬化（与 WithdrawRequest 一致）：
// - createWorkerWithdrawRequest: 事务 Serializable + 重试；DB partial unique index
//   (workerId) WHERE status='pending' 兜底（migration 20260707000000）
// - approveWorkerWithdrawRequest / rejectWorkerWithdrawRequest:
//   updateMany({status:'pending'}) 条件原子更新；影响行数 0 → 返"已审核"
// - **不写 FinanceLedger**（师傅端无 payout 概念，记账会留下不平金额）
//
// 权限：
// - createWorkerWithdrawRequest: 仅 worker 自己（不代发）
// - approve / reject: 仅 admin（worker 角色无法审核）

import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";

export type WorkerWithdrawRequestStatus = "pending" | "approved" | "rejected";

export type WorkerWithdrawRequestAvailable = {
  // Σ WorkerSettlement.workerIncome（分）
  totalIncome: number;
  // Σ pending + approved 的申请金额（分）
  totalPending: number;
  // 剩余可申请（分）
  available: number;
};

export type CreateWorkerWithdrawRequestInput = {
  workerId: string;
  amount: number; // 分
  remark?: string | null;
};

export type CreateWorkerWithdrawRequestResult =
  | { ok: true; id: string; available: WorkerWithdrawRequestAvailable }
  | { ok: false; error: string };

export type ReviewWorkerWithdrawRequestInput = {
  id: string;
  reviewerName: string;
  rejectReason?: string;
};

export type WorkerReviewResult =
  | {
      ok: true;
      status: WorkerWithdrawRequestStatus;
      id: string;
      workerId: string;
    }
  | { ok: false; error: string };

/**
 * 算 worker 的可提现余额
 *
 * 算法：
 *   available = totalIncome − totalPending
 *   totalIncome  = Σ(WS.workerIncome) — 所有 period 加和
 *   totalPending = Σ(WWR.amount) WHERE status ∈ (pending, approved)
 *                                          AND (excludeSelfId = 当前申请 id)
 *
 * 注：师傅端无 payout 概念（没"线下打款"），所以比 merchant 端少 totalPaid 一项
 */
export async function getWorkerAvailable(
  workerId: string,
  excludeSelfId: string | null = null,
): Promise<WorkerWithdrawRequestAvailable> {
  const [incomeAgg, pendingAgg] = await Promise.all([
    prisma.workerSettlement.aggregate({
      where: { workerId },
      _sum: { workerIncome: true },
    }),
    prisma.workerWithdrawRequest.aggregate({
      where: {
        workerId,
        status: { in: ["pending", "approved"] },
        ...(excludeSelfId ? { id: { not: excludeSelfId } } : {}),
      },
      _sum: { amount: true },
    }),
  ]);

  const totalIncome = incomeAgg._sum.workerIncome ?? 0;
  const totalPending = pendingAgg._sum.amount ?? 0;
  const available = totalIncome - totalPending;

  return { totalIncome, totalPending, available };
}

/**
 * 创建师傅提现申请
 *
 * 规则：
 * 1. amount 必为正整数（分）
 * 2. worker 必存在
 * 3. 同一 worker 不允许同时有 2 条 pending 申请
 * 4. amount ≤ available（可提现余额）
 * 5. remark 可空；>= 500 字符截断
 *
 * [P0-1 必修 2026-07-03] 事务 + Serializable + DB partial unique：
 * - 事务内重算 available + count pending，再 create
 * - DB 层 partial unique (workerId) WHERE status='pending' 兜底
 * - Serializable 串行失败（40001）→ 重试一次
 */
export async function createWorkerWithdrawRequest(
  input: CreateWorkerWithdrawRequestInput,
): Promise<CreateWorkerWithdrawRequestResult> {
  // 1. amount 正整数
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "申请金额必须为正整数（分）" };
  }

  // 2. worker 必存在（非事务前置校验 — 快速失败）
  const worker = await prisma.master.findUnique({
    where: { id: input.workerId },
    select: { id: true },
  });
  if (!worker) return { ok: false, error: "师傅不存在" };

  // 5. remark ≤ 500
  const remark = input.remark?.trim().slice(0, 500) || null;

  // 3 + 4. 事务：重算 available + create（双保险）
  const result = await runCreateTx(input.workerId, input.amount, remark);
  return result;
}

/**
 * createWorkerWithdrawRequest 的事务体（Serializable + 重试）
 */
async function runCreateTx(
  workerId: string,
  amount: number,
  remark: string | null,
): Promise<CreateWorkerWithdrawRequestResult> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await prisma.$transaction(
        async (tx) => {
          // 3. 同一 worker pending 计数
          const existingPending = await tx.workerWithdrawRequest.count({
            where: { workerId, status: "pending" },
          });
          if (existingPending > 0) {
            return { ok: false as const, error: "已有未审核的申请，请先处理后再发起" };
          }

          // 4. 重算 available（事务内）
          const [incomeAgg, pendingAgg] = await Promise.all([
            tx.workerSettlement.aggregate({
              where: { workerId },
              _sum: { workerIncome: true },
            }),
            tx.workerWithdrawRequest.aggregate({
              where: {
                workerId,
                status: { in: ["pending", "approved"] },
              },
              _sum: { amount: true },
            }),
          ]);
          const totalIncome = incomeAgg._sum.workerIncome ?? 0;
          const totalPending = pendingAgg._sum.amount ?? 0;
          const available = totalIncome - totalPending;

          if (amount > available) {
            return {
              ok: false as const,
              error: `申请金额(${amount / 100}元)超过可提现余额(${available / 100}元)`,
            };
          }

          // 6. 写入（DB partial unique 兜底 → 第二个并发会抛 P2002）
          const created = await tx.workerWithdrawRequest.create({
            data: {
              workerId,
              amount,
              status: "pending",
              remark,
            },
            select: { id: true },
          });

          return {
            ok: true as const,
            id: created.id,
            available: { totalIncome, totalPending, available },
          };
        },
        { isolationLevel: "Serializable" },
      );
      return r;
    } catch (e) {
      // DB 唯一约束冲突（partial unique）→ 翻译为业务错误
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return { ok: false, error: "已有未审核的申请，请先处理后再发起" };
      }
      // Serializable 串行失败 / write conflict → 重试 1 次
      const msg = (e as Error).message ?? "";
      const isConflict =
        msg.includes("could not serialize") ||
        msg.includes("write conflict") ||
        msg.includes("deadlock");
      if (isConflict && attempt === 1) continue;
      // 重试用尽 — 翻译为"已有未审核"语义
      if (isConflict) {
        return { ok: false, error: "已有未审核的申请，请先处理后再发起" };
      }
      return { ok: false, error: `事务失败：${msg}` };
    }
  }
  return { ok: false, error: "事务失败：超过重试次数" };
}

/**
 * 审核通过（pending → approved）
 *
 * [P0-2 必修 2026-07-03] updateMany({status:'pending'}) 条件原子更新
 * [P0-3 必修 2026-07-03] **不写 FinanceLedger**（师傅端无 payout 流程）
 */
export async function approveWorkerWithdrawRequest(
  input: ReviewWorkerWithdrawRequestInput,
): Promise<WorkerReviewResult> {
  if (!input.reviewerName?.trim()) {
    return { ok: false, error: "审核人为必填" };
  }

  try {
    const r = await prisma.$transaction(
      async (tx) => {
        const { count } = await tx.workerWithdrawRequest.updateMany({
          where: { id: input.id, status: "pending" },
          data: {
            status: "approved",
            reviewerName: input.reviewerName.trim(),
            reviewedAt: new Date(),
            rejectReason: null,
          },
        });
        if (count === 0) {
          const wr = await tx.workerWithdrawRequest.findUnique({
            where: { id: input.id },
            select: { id: true, status: true, workerId: true },
          });
          if (!wr) return { ok: false as const, error: "提现申请不存在" };
          return {
            ok: false as const,
            error: `仅 pending 状态可审核（当前：${wr.status}）`,
          };
        }

        const wr = await tx.workerWithdrawRequest.findUnique({
          where: { id: input.id },
          select: { id: true, workerId: true },
        });

        return {
          ok: true as const,
          status: "approved" as const,
          id: input.id,
          workerId: wr?.workerId ?? "",
        };
      },
      { isolationLevel: "Serializable" },
    );
    return r;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("could not serialize")) {
      return { ok: false, error: `并发冲突，请重试（${msg.slice(0, 80)}）` };
    }
    return { ok: false, error: `事务失败：${msg}` };
  }
}

/**
 * 审核拒绝（pending → rejected）
 *
 * [P0-2 必修 2026-07-03] updateMany({status:'pending'}) 条件原子更新
 */
export async function rejectWorkerWithdrawRequest(
  input: ReviewWorkerWithdrawRequestInput,
): Promise<WorkerReviewResult> {
  if (!input.reviewerName?.trim()) {
    return { ok: false, error: "审核人为必填" };
  }
  if (!input.rejectReason?.trim()) {
    return { ok: false, error: "拒绝原因为必填" };
  }

  try {
    const r = await prisma.$transaction(
      async (tx) => {
        const { count } = await tx.workerWithdrawRequest.updateMany({
          where: { id: input.id, status: "pending" },
          data: {
            status: "rejected",
            reviewerName: input.reviewerName.trim(),
            reviewedAt: new Date(),
            rejectReason: input.rejectReason!.trim().slice(0, 500),
          },
        });
        if (count === 0) {
          const wr = await tx.workerWithdrawRequest.findUnique({
            where: { id: input.id },
            select: { id: true, status: true, workerId: true },
          });
          if (!wr) return { ok: false as const, error: "提现申请不存在" };
          return {
            ok: false as const,
            error: `仅 pending 状态可审核（当前：${wr.status}）`,
          };
        }

        const wr = await tx.workerWithdrawRequest.findUnique({
          where: { id: input.id },
          select: { workerId: true },
        });

        return {
          ok: true as const,
          status: "rejected" as const,
          id: input.id,
          workerId: wr?.workerId ?? "",
        };
      },
      { isolationLevel: "Serializable" },
    );
    return r;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("could not serialize")) {
      return { ok: false, error: `并发冲突，请重试（${msg.slice(0, 80)}）` };
    }
    return { ok: false, error: `事务失败：${msg}` };
  }
}

// ============================================================
// 列表 / 详情查询
// ============================================================

export async function listWorkerWithdrawRequests(filter?: {
  status?: WorkerWithdrawRequestStatus;
  workerId?: string;
}) {
  return prisma.workerWithdrawRequest.findMany({
    where: {
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.workerId ? { workerId: filter.workerId } : {}),
    },
    include: { worker: { select: { id: true, name: true, phone: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getWorkerWithdrawRequest(id: string) {
  return prisma.workerWithdrawRequest.findUnique({
    where: { id },
    include: { worker: { select: { id: true, name: true, phone: true } } },
  });
}

export async function listWorkerWithdrawRequestsByWorker(workerId: string) {
  return prisma.workerWithdrawRequest.findMany({
    where: { workerId },
    orderBy: [{ createdAt: "desc" }],
  });
}
