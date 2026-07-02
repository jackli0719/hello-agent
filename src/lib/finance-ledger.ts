// [任务 14] 财务流水（FinanceLedger）业务逻辑
//
// 设计要点：
// - 事件触发（不在「写完 settlement/withdraw/payout 后回填」）：
//   - settlement.confirmed → recordOrderCommission
//   - withdraw.approved → recordWithdraw
//   - payout.created → recordPayout
// - 幂等：@@unique([type, sourceId]) — 重复触发抛 P2002 错误
// - direction = 'out'（MVP 简化，平台减项）
// - amount: Decimal(12,2) 元（不是分！）— 与 MerchantSettlement/PayoutRecord（分）口径不同
//   写入时 /100 转换；查询时直接 Decimal 聚合
// - 异常处理：record* 失败返回 {ok:false} 但不影响主业务（调用方 try/catch）
// - 只记账，不接银行

import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";

export type FinanceLedgerType = "order_commission" | "withdraw" | "payout";

export type FinanceLedgerDirection = "out";

export type RecordResult =
  { ok: true; id: string } | { ok: false; error: string };

/**
 * 分 → 元（Decimal 用 string 表示避免浮点）
 */
function centsToYuanString(cents: number): string {
  // 直接用字符串除法：100 cents = 1.00 yuan
  const yuan = cents / 100;
  return yuan.toFixed(2);
}

/**
 * 通用 record — 写一笔流水
 *
 * @param type 流水类型
 * @param merchantId 商家 ID（必填）
 * @param sourceId 关联业务对象 id（settlement.id / withdrawRequest.id / payoutRecord.id）
 * @param amountYuan 元（Decimal 字符串）
 * @param remark optional 备注
 * @param orderId optional 关联订单 id（仅 order_commission 才有）
 */
async function record(
  type: FinanceLedgerType,
  merchantId: string,
  sourceId: string,
  amountYuan: string,
  remark?: string | null,
  orderId?: string | null,
): Promise<RecordResult> {
  try {
    const created = await prisma.financeLedger.create({
      data: {
        merchantId,
        type,
        direction: "out",
        sourceId,
        orderId: orderId ?? null,
        amount: new Prisma.Decimal(amountYuan),
        remark: remark ?? null,
      },
      select: { id: true },
    });
    return { ok: true, id: created.id };
  } catch (e) {
    // 唯一约束冲突（重复记账）→ 返回 ok:false 但不抛错（幂等）
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return { ok: false, error: "重复记账：同 type+sourceId 已存在" };
    }
    const msg = (e as Error).message;
    return { ok: false, error: `记账失败：${msg}` };
  }
}

// ============================================================
// 3 个事件 record 函数
// ============================================================

/**
 * [事件 1] settlement.confirmed → 记一笔 order_commission
 *
 * @param settlementId MerchantSettlement.id
 * @param merchantId 商家 ID
 * @param merchantIncomeCents 商家应收金额（分）— 来自 settlement.merchantIncome
 * @param remark optional
 */
export async function recordOrderCommission(input: {
  settlementId: string;
  merchantId: string;
  merchantIncomeCents: number;
  remark?: string | null;
}): Promise<RecordResult> {
  return record(
    "order_commission",
    input.merchantId,
    input.settlementId,
    centsToYuanString(input.merchantIncomeCents),
    input.remark ?? `结算汇总结算 ${input.settlementId.slice(0, 8)}`,
  );
}

/**
 * [事件 2] withdraw.approved → 记一笔 withdraw
 */
export async function recordWithdraw(input: {
  withdrawRequestId: string;
  merchantId: string;
  amountCents: number;
  remark?: string | null;
}): Promise<RecordResult> {
  return record(
    "withdraw",
    input.merchantId,
    input.withdrawRequestId,
    centsToYuanString(input.amountCents),
    input.remark ?? `提现申请 ${input.withdrawRequestId.slice(0, 8)}`,
  );
}

/**
 * [事件 3] payout.created → 记一笔 payout
 */
export async function recordPayout(input: {
  payoutRecordId: string;
  merchantId: string;
  amountCents: number;
  remark?: string | null;
}): Promise<RecordResult> {
  return record(
    "payout",
    input.merchantId,
    input.payoutRecordId,
    centsToYuanString(input.amountCents),
    input.remark ?? `线下打款 ${input.payoutRecordId.slice(0, 8)}`,
  );
}

// ============================================================
// 列表查询
// ============================================================

export async function listFinanceLedgers(filter?: {
  type?: FinanceLedgerType;
  direction?: FinanceLedgerDirection;
  merchantId?: string;
}) {
  return prisma.financeLedger.findMany({
    where: {
      ...(filter?.type ? { type: filter.type } : {}),
      ...(filter?.direction ? { direction: filter.direction } : {}),
      ...(filter?.merchantId ? { merchantId: filter.merchantId } : {}),
    },
    include: { merchant: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

/**
 * 统计卡 — 算总流水 / 本月流水 / 按 type 分桶
 *
 * 返回 { totalOut, thisMonthOut, byType: { order_commission: x, withdraw: y, payout: z } }
 */
export async function getFinanceLedgerStats(filter?: {
  merchantId?: string;
}): Promise<{
  totalOut: string;
  thisMonthOut: string;
  byType: { order_commission: string; withdraw: string; payout: string };
}> {
  const where = {
    direction: "out",
    ...(filter?.merchantId ? { merchantId: filter.merchantId } : {}),
  };

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 4 个聚合并行
  const [totalAgg, monthAgg, ocAgg, wdAgg, poAgg] = await Promise.all([
    prisma.financeLedger.aggregate({
      where,
      _sum: { amount: true },
    }),
    prisma.financeLedger.aggregate({
      where: { ...where, createdAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.financeLedger.aggregate({
      where: { ...where, type: "order_commission" },
      _sum: { amount: true },
    }),
    prisma.financeLedger.aggregate({
      where: { ...where, type: "withdraw" },
      _sum: { amount: true },
    }),
    prisma.financeLedger.aggregate({
      where: { ...where, type: "payout" },
      _sum: { amount: true },
    }),
  ]);

  return {
    totalOut: (totalAgg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    thisMonthOut: (monthAgg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    byType: {
      order_commission: (ocAgg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      withdraw: (wdAgg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      payout: (poAgg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    },
  };
}

/**
 * 商家当前可用余额（基于 ledger 计算）
 *
 * 公式：available = Σ(order_commission) - Σ(withdraw) - Σ(payout)
 *
 * 注意：这与 WithdrawRequest 的算法类似，但口径不同：
 * - WithdrawRequest 用「settlement.merchantIncome」为基数（业务源头）
 * - FinanceLedger 用「已记账的 order_commission」为基数（账本源头）
 * 两者在生产环境应该一致；本函数用于「账本视角」的交叉验证
 */
export async function getMerchantLedgerBalance(merchantId: string): Promise<{
  totalCommission: string;
  totalWithdraw: string;
  totalPayout: string;
  balance: string;
}> {
  const [oc, wd, po] = await Promise.all([
    prisma.financeLedger.aggregate({
      where: { merchantId, type: "order_commission" },
      _sum: { amount: true },
    }),
    prisma.financeLedger.aggregate({
      where: { merchantId, type: "withdraw" },
      _sum: { amount: true },
    }),
    prisma.financeLedger.aggregate({
      where: { merchantId, type: "payout" },
      _sum: { amount: true },
    }),
  ]);
  const totalOc = oc._sum.amount ?? new Prisma.Decimal(0);
  const totalWd = wd._sum.amount ?? new Prisma.Decimal(0);
  const totalPo = po._sum.amount ?? new Prisma.Decimal(0);
  const balance = totalOc.minus(totalWd).minus(totalPo);
  return {
    totalCommission: totalOc.toFixed(2),
    totalWithdraw: totalWd.toFixed(2),
    totalPayout: totalPo.toFixed(2),
    balance: balance.toFixed(2),
  };
}
