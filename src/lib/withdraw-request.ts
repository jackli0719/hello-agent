// [任务 13] 商家提现申请（WithdrawRequest）业务逻辑
//
// 设计要点：
// - merchantId: FK Merchant (FK active 才允许申请)
// - amount: 单位 分；merchant 自填
// - status: pending / approved / rejected
//   - pending → approved / rejected (单向)
//   - approved → 不联动 PayoutRecord；admin 仍走 /merchant-settlements 录打款
// - remark: merchant 填的用途（optional）
// - rejectReason: admin 必填拒绝原因（status=rejected 时必填）
// - 可提现余额 = Σ(MerchantSettlement.merchantIncome | status ∈ confirmed, archived)
//                − Σ(PayoutRecord.amount)
//                − Σ(WithdrawRequest.amount | status ∈ pending, approved)
// - 同一 merchant 不能同时有 2 条 pending 申请
//
// 金额单位：分（与 MerchantSettlement / PayoutRecord 一致）
//
// [P0 必修 2026-07-03] 并发 + 状态机硬化：
// - createWithdrawRequest: 事务 Serializable + 重试；DB partial unique index
//   (merchantId) WHERE status='pending' 兜底（migration 20260705000000）
// - approveWithdrawRequest / rejectWithdrawRequest: updateMany({status:'pending'})
//   条件原子更新；影响行数 0 → 返"已审核或不存在"
// - approveWithdrawRequest 业务状态 + recordWithdrawInTx 写 ledger 同事务；
//   ledger 写失败 → approve 回滚，财务/业务强一致

import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { recordWithdrawInTx } from "@/src/lib/finance-ledger";

export type WithdrawRequestStatus = "pending" | "approved" | "rejected";

export type WithdrawRequestAvailable = {
  // Σ 已确认 + 已归档的 merchantIncome（分）
  totalIncome: number;
  // Σ 已打款（分）
  totalPaid: number;
  // Σ pending + approved 的申请金额（分）
  totalPending: number;
  // 剩余可申请（分）
  available: number;
};

export type CreateWithdrawRequestInput = {
  merchantId: string;
  amount: number; // 分
  remark?: string | null;
};

export type CreateWithdrawRequestResult =
  | { ok: true; id: string; available: WithdrawRequestAvailable }
  | { ok: false; error: string };

export type ReviewWithdrawRequestInput = {
  id: string;
  reviewerName: string;
  rejectReason?: string;
};

export type ReviewResult =
  | {
      ok: true;
      status: WithdrawRequestStatus;
      id: string;
      merchantId: string;
    }
  | { ok: false; error: string };

/**
 * 算 merchant 的可提现余额
 *
 * 算法：
 *   available = totalIncome − totalPaid − totalPending
 *   totalIncome = Σ(MS.merchantIncome) WHERE MS.status ∈ (confirmed, archived)
 *   totalPaid   = Σ(PayoutRecord.amount)
 *   totalPending = Σ(WR.amount)         WHERE WR.status ∈ (pending, approved)
 *                                           AND (excludeSelfId = 当前申请 id，用于 approve 时排除自己)
 */
export async function getMerchantAvailable(
  merchantId: string,
  excludeSelfId: string | null = null,
): Promise<WithdrawRequestAvailable> {
  const [incomeAgg, paidAgg, pendingAgg] = await Promise.all([
    prisma.merchantSettlement.aggregate({
      where: {
        merchantId,
        status: { in: ["confirmed", "archived"] },
      },
      _sum: { merchantIncome: true },
    }),
    prisma.payoutRecord.aggregate({
      where: { merchantId },
      _sum: { amount: true },
    }),
    prisma.withdrawRequest.aggregate({
      where: {
        merchantId,
        status: { in: ["pending", "approved"] },
        ...(excludeSelfId ? { id: { not: excludeSelfId } } : {}),
      },
      _sum: { amount: true },
    }),
  ]);

  const totalIncome = incomeAgg._sum.merchantIncome ?? 0;
  const totalPaid = paidAgg._sum.amount ?? 0;
  const totalPending = pendingAgg._sum.amount ?? 0;
  const available = totalIncome - totalPaid - totalPending;

  return { totalIncome, totalPaid, totalPending, available };
}

/**
 * 创建提现申请（admin 代发 / MVP 简化）
 *
 * 规则：
 * 1. amount 必为正整数（分）
 * 2. merchantId 存在且 status=active
 * 3. 同一 merchant 不允许同时有 2 条 pending 申请（pending 不可重入）
 * 4. amount ≤ available（可提现余额）
 * 5. remark 可空；>= 500 字符截断
 *
 * [P0-1 必修 2026-07-03] 事务 + Serializable + DB partial unique：
 * - 事务内重算 available + count pending，再 create
 * - DB 层 partial unique (merchantId) WHERE status='pending' 兜底：
 *   即使 Serializable 隔离失效（read skew），第二个 create 也会因 unique 冲突抛 P2002
 * - Serializable 串行失败（40001）→ 重试一次
 */
export async function createWithdrawRequest(
  input: CreateWithdrawRequestInput,
): Promise<CreateWithdrawRequestResult> {
  // 1. amount 正整数
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "申请金额必须为正整数（分）" };
  }

  // 2. merchant 必存在且 active（非事务前置校验 — 快速失败）
  const merchant = await prisma.merchant.findUnique({
    where: { id: input.merchantId },
    select: { id: true, status: true },
  });
  if (!merchant) return { ok: false, error: "商家不存在" };
  if (merchant.status !== "active") {
    return { ok: false, error: "商家未激活，不能申请提现" };
  }

  // 5. remark ≤ 500
  const remark = input.remark?.trim().slice(0, 500) || null;

  // 3 + 4. 事务：重算 available + create（双保险）
  // [P0-1] DB partial unique 兜底；应用层事务内重算兜底
  const result = await runCreateTx(input.merchantId, input.amount, remark);
  return result;
}

/**
 * createWithdrawRequest 的事务体（Serializable + 重试）
 * 拆出来便于内部重试（PG 串行失败 → 重试 1 次）
 */
async function runCreateTx(
  merchantId: string,
  amount: number,
  remark: string | null,
): Promise<CreateWithdrawRequestResult> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await prisma.$transaction(
        async (tx) => {
          // 3. 同一 merchant pending 计数
          const existingPending = await tx.withdrawRequest.count({
            where: { merchantId, status: "pending" },
          });
          if (existingPending > 0) {
            return {
              ok: false as const,
              error: "已有未审核的申请，请先处理后再发起",
            };
          }

          // 4. 重算 available（事务内）
          const [incomeAgg, paidAgg, pendingAgg] = await Promise.all([
            tx.merchantSettlement.aggregate({
              where: {
                merchantId,
                status: { in: ["confirmed", "archived"] },
              },
              _sum: { merchantIncome: true },
            }),
            tx.payoutRecord.aggregate({
              where: { merchantId },
              _sum: { amount: true },
            }),
            tx.withdrawRequest.aggregate({
              where: {
                merchantId,
                status: { in: ["pending", "approved"] },
              },
              _sum: { amount: true },
            }),
          ]);
          const totalIncome = incomeAgg._sum.merchantIncome ?? 0;
          const totalPaid = paidAgg._sum.amount ?? 0;
          const totalPending = pendingAgg._sum.amount ?? 0;
          const available = totalIncome - totalPaid - totalPending;

          if (amount > available) {
            return {
              ok: false as const,
              error: `申请金额(${amount / 100}元)超过可提现余额(${available / 100}元)`,
            };
          }

          // 6. 写入（DB partial unique 兜底 → 第二个并发会抛 P2002）
          const created = await tx.withdrawRequest.create({
            data: {
              merchantId,
              amount,
              status: "pending",
              remark,
            },
            select: { id: true },
          });

          return {
            ok: true as const,
            id: created.id,
            available: { totalIncome, totalPaid, totalPending, available },
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
      // 重试用尽 — 翻译为"已有未审核"语义（同商家并发时另一方通常已写入 pending）
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
 * [P0-2 必修 2026-07-03] 改用 updateMany({where:{id,status:'pending'}})，影响 0 行 → 已审核
 * [P0-3 必修 2026-07-03] WR status 变更 + recordWithdrawInTx 写 ledger 同事务；
 *   ledger 写失败 → approve 回滚
 *
 * 注：approved 不联动 PayoutRecord；admin 继续在 /merchant-settlements 录打款
 */
export async function approveWithdrawRequest(
  input: ReviewWithdrawRequestInput,
): Promise<ReviewResult> {
  if (!input.reviewerName?.trim()) {
    return { ok: false, error: "审核人为必填" };
  }

  try {
    const r = await prisma.$transaction(
      async (tx) => {
        // 原子状态机：updateMany 带 status:'pending' 条件 → 防并发覆盖
        const { count } = await tx.withdrawRequest.updateMany({
          where: { id: input.id, status: "pending" },
          data: {
            status: "approved",
            reviewerName: input.reviewerName.trim(),
            reviewedAt: new Date(),
            rejectReason: null,
          },
        });
        if (count === 0) {
          // id 不存在 OR 已审核 — 查出来给用户明确错误
          const wr = await tx.withdrawRequest.findUnique({
            where: { id: input.id },
            select: { id: true, status: true, merchantId: true },
          });
          if (!wr) return { ok: false as const, error: "提现申请不存在" };
          return {
            ok: false as const,
            error: `仅 pending 状态可审核（当前：${wr.status}）`,
          };
        }

        // [P0-3] 同事务写 ledger — 失败触发整体回滚
        const wr = await tx.withdrawRequest.findUnique({
          where: { id: input.id },
          select: { id: true, merchantId: true, amount: true },
        });
        if (wr && wr.amount > 0) {
          await recordWithdrawInTx(tx, {
            withdrawRequestId: wr.id,
            merchantId: wr.merchantId,
            amountCents: wr.amount,
            remark: `提现申请 ${wr.id.slice(0, 12)}`,
          });
        }

        return {
          ok: true as const,
          status: "approved" as const,
          id: input.id,
          merchantId: wr?.merchantId ?? "",
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
 * [P0-2 必修 2026-07-03] updateMany({status:'pending'})，影响 0 行 → 已审核
 * 拒绝不写 ledger（业务不进账）
 */
export async function rejectWithdrawRequest(
  input: ReviewWithdrawRequestInput,
): Promise<ReviewResult> {
  if (!input.reviewerName?.trim()) {
    return { ok: false, error: "审核人为必填" };
  }
  if (!input.rejectReason?.trim()) {
    return { ok: false, error: "拒绝原因为必填" };
  }

  try {
    const r = await prisma.$transaction(
      async (tx) => {
        const { count } = await tx.withdrawRequest.updateMany({
          where: { id: input.id, status: "pending" },
          data: {
            status: "rejected",
            reviewerName: input.reviewerName.trim(),
            reviewedAt: new Date(),
            rejectReason: input.rejectReason!.trim().slice(0, 500),
          },
        });
        if (count === 0) {
          const wr = await tx.withdrawRequest.findUnique({
            where: { id: input.id },
            select: { id: true, status: true, merchantId: true },
          });
          if (!wr) return { ok: false as const, error: "提现申请不存在" };
          return {
            ok: false as const,
            error: `仅 pending 状态可审核（当前：${wr.status}）`,
          };
        }

        const wr = await tx.withdrawRequest.findUnique({
          where: { id: input.id },
          select: { merchantId: true },
        });

        return {
          ok: true as const,
          status: "rejected" as const,
          id: input.id,
          merchantId: wr?.merchantId ?? "",
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

export async function listWithdrawRequests(filter?: {
  status?: WithdrawRequestStatus;
  merchantId?: string;
}) {
  return prisma.withdrawRequest.findMany({
    where: {
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.merchantId ? { merchantId: filter.merchantId } : {}),
    },
    include: { merchant: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getWithdrawRequest(id: string) {
  return prisma.withdrawRequest.findUnique({
    where: { id },
    include: { merchant: { select: { id: true, name: true } } },
  });
}

export async function listWithdrawRequestsByMerchant(merchantId: string) {
  return prisma.withdrawRequest.findMany({
    where: { merchantId },
    orderBy: [{ createdAt: "desc" }],
  });
}
