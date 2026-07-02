// [任务 12] 线下打款记录（PayoutRecord）业务逻辑
//
// 设计要点：
// - withdrawRequestId = MerchantSettlement.id
// - 状态闸门：仅 confirmed / archived 状态可录入；pending 拒绝
// - 多条 + 累计校验：同 settlement 允许多条 PayoutRecord；
//   录入前 Σ(已存在 PayoutRecord.amount) + amount ≤ settlement.merchantIncome
// - amount 单位：分
// - proofUrl optional；若填则必须 http(s):// 开头
// - operator 存 User.name（冗余 — 删 user 不影响记录）
// - 只录入，不接支付通道（不调任何外部 API）
//
// 金额单位：分（与 MerchantSettlement 一致）

import { prisma } from "@/src/lib/db";

export type PayoutCreateInput = {
  withdrawRequestId: string;
  amount: number; // 分
  paidAt: Date;
  proofUrl?: string | null;
  operator: string; // User.name
};

export type PayoutCreateResult =
  | {
      ok: true;
      id: string;
      merchantId: string;
      cumulative: number; // 含本次
      remaining: number; // merchantIncome - cumulative
    }
  | { ok: false; error: string };

/**
 * URL 校验 — http(s):// 开头 + 非空 host
 * 失败返回 false
 */
export function isValidUrl(s: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 创建线下打款记录
 *
 * 规则：
 * 1. settlement 必须存在
 * 2. status ∈ {confirmed, archived}（pending 拒绝）
 * 3. amount > 0（单位分）
 * 4. paidAt 必填（Date 对象）
 * 5. proofUrl 若填了则必须 http(s):// 开头
 * 6. Σ(已存在 amount) + amount ≤ settlement.merchantIncome（累计校验）
 */
export async function createPayoutRecord(
  input: PayoutCreateInput,
): Promise<PayoutCreateResult> {
  // 1. amount 正数
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "打款金额必须为正整数（分）" };
  }
  // 2. paidAt 必填（Date）
  if (!(input.paidAt instanceof Date) || isNaN(input.paidAt.getTime())) {
    return { ok: false, error: "打款时间为必填" };
  }
  // 3. proofUrl 校验
  const proofUrl = input.proofUrl?.trim() ?? "";
  if (proofUrl && !isValidUrl(proofUrl)) {
    return { ok: false, error: "打款凭证 URL 必须以 http(s):// 开头" };
  }
  // 4. operator 必填
  if (!input.operator.trim()) {
    return { ok: false, error: "操作人为必填" };
  }

  // 5. 查 settlement
  const settlement = await prisma.merchantSettlement.findUnique({
    where: { id: input.withdrawRequestId },
    select: {
      id: true,
      merchantId: true,
      merchantIncome: true,
      status: true,
    },
  });
  if (!settlement) return { ok: false, error: "结算记录不存在" };

  // 6. 状态闸门
  if (settlement.status !== "confirmed" && settlement.status !== "archived") {
    return { ok: false, error: "仅已确认 / 已归档的结算可录打款" };
  }

  // 7. 累计校验
  const agg = await prisma.payoutRecord.aggregate({
    where: { withdrawRequestId: settlement.id },
    _sum: { amount: true },
  });
  const existing = agg._sum.amount ?? 0;
  const cumulative = existing + input.amount;
  if (cumulative > settlement.merchantIncome) {
    return {
      ok: false,
      error: `累计打款(${cumulative / 100}元)超过应收金额(${settlement.merchantIncome / 100}元)`,
    };
  }

  // 8. 写入
  const created = await prisma.payoutRecord.create({
    data: {
      withdrawRequestId: settlement.id,
      merchantId: settlement.merchantId,
      amount: input.amount,
      paidAt: input.paidAt,
      proofUrl: proofUrl || null,
      operator: input.operator.trim(),
    },
    select: { id: true },
  });

  return {
    ok: true,
    id: created.id,
    merchantId: settlement.merchantId,
    cumulative,
    remaining: settlement.merchantIncome - cumulative,
  };
}

/**
 * 查 settlement 下所有打款记录（按 paidAt desc）
 */
export async function listPayoutsBySettlement(settlementId: string) {
  return prisma.payoutRecord.findMany({
    where: { withdrawRequestId: settlementId },
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
  });
}

/**
 * 查所有打款记录（带 merchant + settlement 关联），按 paidAt desc
 */
export async function listAllPayouts() {
  return prisma.payoutRecord.findMany({
    include: {
      merchant: { select: { id: true, name: true } },
      settlement: { select: { id: true, period: true, status: true } },
    },
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
  });
}

/**
 * 查 settlement 累计打款额（cents）
 */
export async function sumPayoutsBySettlement(
  settlementId: string,
): Promise<number> {
  const agg = await prisma.payoutRecord.aggregate({
    where: { withdrawRequestId: settlementId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}
