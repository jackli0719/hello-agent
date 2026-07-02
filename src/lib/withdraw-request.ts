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

import { prisma } from "@/src/lib/db";

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
 */
export async function createWithdrawRequest(
  input: CreateWithdrawRequestInput,
): Promise<CreateWithdrawRequestResult> {
  // 1. amount 正整数
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "申请金额必须为正整数（分）" };
  }

  // 2. merchant 必存在且 active
  const merchant = await prisma.merchant.findUnique({
    where: { id: input.merchantId },
    select: { id: true, status: true },
  });
  if (!merchant) return { ok: false, error: "商家不存在" };
  if (merchant.status !== "active") {
    return { ok: false, error: "商家未激活，不能申请提现" };
  }

  // 3. 同一 merchant 不允许 2 条 pending
  const existingPending = await prisma.withdrawRequest.count({
    where: { merchantId: input.merchantId, status: "pending" },
  });
  if (existingPending > 0) {
    return { ok: false, error: "同一商家已有未审核的申请，请先处理后再发起" };
  }

  // 4. 上限校验
  const available = await getMerchantAvailable(input.merchantId);
  if (input.amount > available.available) {
    return {
      ok: false,
      error: `申请金额(${input.amount / 100}元)超过可提现余额(${available.available / 100}元)`,
    };
  }

  // 5. remark ≤ 500
  const remark = input.remark?.trim().slice(0, 500) || null;

  // 6. 写入
  const created = await prisma.withdrawRequest.create({
    data: {
      merchantId: input.merchantId,
      amount: input.amount,
      status: "pending",
      remark,
    },
    select: { id: true },
  });

  return { ok: true, id: created.id, available };
}

/**
 * 审核通过（pending → approved）
 *
 * 规则：
 * 1. 申请必须存在
 * 2. status 必须是 pending（终态不可改）
 * 3. reviewerName 必填
 *
 * 注：approved 不联动 PayoutRecord；admin 继续在 /merchant-settlements 录打款
 */
export async function approveWithdrawRequest(
  input: ReviewWithdrawRequestInput,
): Promise<ReviewResult> {
  if (!input.reviewerName?.trim()) {
    return { ok: false, error: "审核人为必填" };
  }

  // 拿当前状态
  const wr = await prisma.withdrawRequest.findUnique({
    where: { id: input.id },
    select: { id: true, status: true, merchantId: true },
  });
  if (!wr) return { ok: false, error: "提现申请不存在" };

  if (wr.status !== "pending") {
    return { ok: false, error: "仅 pending 状态可审核" };
  }

  await prisma.withdrawRequest.update({
    where: { id: input.id },
    data: {
      status: "approved",
      reviewerName: input.reviewerName.trim(),
      reviewedAt: new Date(),
      rejectReason: null, // approved 时清掉旧的 rejectReason
    },
  });

  return {
    ok: true,
    status: "approved",
    id: wr.id,
    merchantId: wr.merchantId,
  };
}

/**
 * 审核拒绝（pending → rejected）
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

  const wr = await prisma.withdrawRequest.findUnique({
    where: { id: input.id },
    select: { id: true, status: true, merchantId: true },
  });
  if (!wr) return { ok: false, error: "提现申请不存在" };

  if (wr.status !== "pending") {
    return { ok: false, error: "仅 pending 状态可审核" };
  }

  await prisma.withdrawRequest.update({
    where: { id: input.id },
    data: {
      status: "rejected",
      reviewerName: input.reviewerName.trim(),
      reviewedAt: new Date(),
      rejectReason: input.rejectReason.trim().slice(0, 500),
    },
  });

  return {
    ok: true,
    status: "rejected",
    id: wr.id,
    merchantId: wr.merchantId,
  };
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
